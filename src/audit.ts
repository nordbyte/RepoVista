import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { allowedEvidencePaths, collectAuditDiffScope, createInitialMeta, reportFolderName } from "./audit-context.js";
import { writeStructuredOutputs } from "./audit-outputs.js";
import { applyBaselineToFindings } from "./baseline.js";
import { projectScanFingerprint, updateAuditCache } from "./cache.js";
import { maybeRunDeepRiskReview } from "./deep-review.js";
import { PreflightError } from "./errors.js";
import { collectEvidence, type EvidenceDependencies, hasFailedChecks } from "./evidence.js";
import { validateFindingsEvidence } from "./evidence-validation.js";
import { assignFindingsToFeatures, syncFeatureRecords, updateFeatureRecordsFromFindings } from "./feature-state.js";
import { extractFindings } from "./findings.js";
import { createProjectInventory } from "./inventory.js";
import { Logger } from "./logger.js";
import { PHASE_SCHEMA_VERSION, extractStructuredPhaseReport } from "./phase-schema.js";
import { addPromptManifestPhase, allowedEvidencePathsFromPromptManifest, createPromptManifest } from "./prompt-manifest.js";
import { ANALYSIS_PHASES, PROMPT_CONTEXT_VERSION, type PromptContext } from "./prompts.js";
import { canParallelizePhase, runParallelPhase, runSinglePhase } from "./phase-runner.js";
import { runPreflight, type PreflightDependencies } from "./preflight.js";
import { createParallelExecutionMeta, createProjectMap, loadProjectMap, saveProjectMap } from "./project-map.js";
import { scanProject } from "./project-scan.js";
import { getReportProvider } from "./providers/index.js";
import { resolveProviderDefaultModel } from "./provider-models.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { applyAuditProfile } from "./profiles.js";
import { QUALITY_GATES_VERSION, validateReportQuality } from "./quality-gates.js";
import { maybeRepairPhaseReport } from "./report-repair.js";
import {
  expandSelectedPhases,
  findPreviousPhaseStatus,
  loadExistingReports,
  markSkippedOrPreserved,
  phaseStatus,
  readPreviousMeta,
  safeReadReport,
  isReusablePhaseReport,
  shouldRunPhase,
  updatePhaseStatus
} from "./resume-manager.js";
import { createRunId } from "./run-id.js";
import {
  prepareRunDirectory,
  readReport,
  reportPath,
  useExistingRunDirectory,
  writeJsonFile,
  writeMeta,
  writeMarkdownReport
} from "./reports.js";
import { resolveWorkspaceScope, workspaceIncludes } from "./workspaces.js";
import { appendGithubStepSummary } from "./ci-summary.js";
import type {
  AuditMeta,
  AuditOptions,
  DiffScope,
  EvidencePack,
  ParallelExecutionMeta,
  PhaseReportStatus,
  ProviderRunResult,
  RunPaths,
  StructuredFinding
} from "./types.js";

export interface AuditDependencies extends PreflightDependencies, EvidenceDependencies {
  cwd?: string;
  now?: Date;
  version?: string;
  resolveProviderDefaultModel?: (provider: string, options: AuditOptions) => Promise<string | undefined>;
  runProvider?: typeof runProviderPhase;
  runCodex?: typeof runProviderPhase;
  spawnAdapter?: SpawnAdapter;
}

export interface AuditResult {
  paths: RunPaths;
  meta: AuditMeta;
  exitCode: number;
}

export async function runAudit(options: AuditOptions, dependencies: AuditDependencies = {}): Promise<AuditResult> {
  options = applyAuditProfile(options);
  const projectRoot = dependencies.cwd ?? process.cwd();
  const now = dependencies.now ?? new Date();
  const version = dependencies.version ?? "0.0.0";
  const workspaceScope = await resolveWorkspaceScope(projectRoot, options);
  options = {
    ...options,
    includes: workspaceIncludes(options, workspaceScope)
  };
  const logger = new Logger(options.progress);
  const createLogs = options.keepLogs || options.json;
  const paths = await createRunPaths(projectRoot, options, now, createLogs);
  const provider = getReportProvider(options.provider ?? "codex");
  const effectiveModel = options.model ?? await (dependencies.resolveProviderDefaultModel ?? resolveProviderDefaultModel)(provider.id, options);

  const meta = createInitialMeta(projectRoot, paths, options, version, now, { model: effectiveModel });
  meta.workspace = workspaceScope;
  const previousReports: Record<string, string> = {};
  const previousMeta = options.resumeDir ? await readPreviousMeta(paths.runDir) : undefined;

  try {
    if (options.resumeDir) {
      await loadExistingReports(paths, previousReports, meta.phases, previousMeta);
    }

    logger.step("Preflight checks");
    const preflight = await runPreflight(projectRoot, paths.runDir, options, dependencies);
    meta.preflight = preflight;
    for (const warning of preflight.warnings) {
      logger.warn(warning);
    }

    logger.step("Collecting evidence pack");
    const evidence = await collectEvidence(projectRoot, options, dependencies);
    meta.evidence = evidence;
    if (hasFailedChecks(evidence)) {
      logger.warn("One or more local check commands failed. The report will include the check output.");
    }

    const diffScope = options.since ? await collectAuditDiffScope(projectRoot, options.since, logger) : undefined;

    logger.step("Scanning project files");
    const projectScan = await scanProject(projectRoot, {
      outDir: options.outDir,
      includes: options.includes,
      ignores: options.ignores
    });
    const promptGuidance = await loadPromptGuidance(options.promptFile, projectRoot);

    logger.step("Creating project inventory");
    const inventory = await createProjectInventory(projectRoot, {
      outDir: options.outDir,
      includes: options.includes,
      ignores: options.ignores,
      ai: {
        provider: options.provider ?? "codex",
        displayName: provider.displayName,
        executable: provider.executable,
        model: effectiveModel,
        profile: options.profile,
        reasoning: options.reasoning,
        fastMode: options.fastMode,
        sandbox: options.sandbox
      },
      evidence,
      now,
      scan: projectScan
    });
    for (const warning of inventory.warnings) {
      logger.warn(warning);
    }

    const inventoryPath = reportPath(paths.runDir, "00-inventory.md");
    await writeMarkdownReport(inventoryPath, inventory.markdown);
    previousReports["00-inventory.md"] = inventory.markdown;

    const featureMap = await createProjectMap(projectRoot, options, now, diffScope, projectScan);
    const featureStateDir = await syncFeatureRecords(projectRoot, options.outDir, featureMap.features, paths.runId, now);
    const featuresPath = reportPath(paths.runDir, "features.json");
    await writeJsonFile(featuresPath, {
      schemaVersion: 1,
      runId: paths.runId,
      since: diffScope,
      features: featureMap.features,
      featureStateDir
    });
    const promptManifest = createPromptManifest(paths.runId, now, featureMap.features, diffScope);
    const promptManifestFingerprint = promptManifestInputFingerprint({
      options,
      projectFiles: projectScan.files,
      features: featureMap.features,
      diffScope,
      promptGuidance: promptGuidance.content
    });
    const reuseKey = stableCacheFingerprint(auditCacheContext(options, diffScope, {
      providerVersion: evidence.aiProvider.version,
      promptManifestFingerprint,
      effectiveModel
    }));
    const scanFingerprint = projectScanFingerprint(projectScan.files, {
      reuseKey,
      providerVersion: evidence.aiProvider.version,
      promptManifestFingerprint,
      promptContextVersion: PROMPT_CONTEXT_VERSION,
      phaseSchemaVersion: PHASE_SCHEMA_VERSION,
      qualityGateVersion: QUALITY_GATES_VERSION
    });
    meta.cache = await updateAuditCache({
      projectRoot,
      outDir: options.outDir,
      runDir: paths.runDir,
      runId: paths.runId,
      scanFingerprint,
      reuseKey,
      promptManifestFingerprint,
      providerVersion: evidence.aiProvider.version,
      promptContextVersion: PROMPT_CONTEXT_VERSION,
      phaseSchemaVersion: PHASE_SCHEMA_VERSION,
      qualityGateVersion: QUALITY_GATES_VERSION,
      fileCount: projectScan.files.length,
      enabled: Boolean(options.incremental),
      now
    });
    if (meta.cache.enabled && meta.cache.hit) {
      logger.info(`Incremental scan cache hit. Previous matching run: ${meta.cache.previousRunId ?? "unknown"}.`);
    } else if (meta.cache.enabled && meta.cache.mismatchReasons?.length) {
      logger.info(`Incremental cache not reused: ${meta.cache.mismatchReasons.join("; ")}.`);
    }
    const incrementalReports = meta.cache.enabled && meta.cache.hit && meta.cache.previousRunDir
      ? await loadReusableReportsFromRun(meta.cache.previousRunDir)
      : {};

    const selectedPhases = expandSelectedPhases(options.phases ?? []);
    const runPhase = dependencies.runProvider ?? dependencies.runCodex ?? runProviderPhase;
    const parallel = await resolveParallelMeta(projectRoot, options, logger, featureMap);
    meta.parallel = parallel;
    let detailPhaseRan = false;

    for (const phase of ANALYSIS_PHASES) {
      const status = phaseStatus(meta.phases, phase);
      const previousStatus = findPreviousPhaseStatus(previousMeta, phase.id);
      if (!options.resumeDir && !selectedPhases && incrementalReports[phase.reportFile]) {
        const phaseReportPath = reportPath(paths.runDir, phase.reportFile);
        await writeMarkdownReport(phaseReportPath, incrementalReports[phase.reportFile]);
        previousReports[phase.reportFile] = incrementalReports[phase.reportFile];
        await markSkippedOrPreserved(status, phase, paths, previousReports);
        logger.info(`Incremental cache reused ${phase.reportFile}.`);
        continue;
      }
      const shouldRun = await shouldRunPhase(phase, status, paths, options, selectedPhases, detailPhaseRan);
      if (!shouldRun) {
        await markSkippedOrPreserved(status, phase, paths, previousReports);
        continue;
      }

      logger.step(`${phase.title}`);
      status.status = "pending";
      status.error = undefined;
      status.repairAttempts = undefined;

      const phaseReportPath = reportPath(paths.runDir, phase.reportFile);
      const preservedReport = await reusableReportForPreservation(phase.id, phaseReportPath, previousReports[phase.reportFile]);
      const context: PromptContext = {
        language: options.language,
        projectRoot,
        reportFolderName: reportFolderName(options.outDir),
        inventoryMarkdown: inventory.markdown,
        previousReports,
        since: diffScope,
        features: featureMap.features,
        reviewMode: options.reviewMode ?? "default",
        additionalGuidance: promptGuidance.content
      };
      const prompt = phase.buildPrompt(context);
      await addPromptManifestPhase(promptManifest, {
        phaseId: phase.id,
        reportFile: phase.reportFile,
        prompt,
        inventoryPath,
        previousReports,
        promptFilePath: promptGuidance.path,
        featureMapPath: featuresPath,
        projectFiles: projectScan.files,
        omittedProjectFileCount: projectScan.omittedFileCount
      });
      let result = parallel && parallel.effectiveParallelism > 1 && canParallelizePhase(phase)
        ? await runParallelPhase({
            phase,
            prompt,
            context,
            projectRoot,
            paths,
            options,
            parallel,
            runPhase,
            spawnAdapter: dependencies.spawnAdapter,
            resume: Boolean(options.resumeDir),
            status,
            previousStatus
          })
        : await runSinglePhase({
            phase,
            prompt,
            projectRoot,
            phaseReportPath,
            paths,
            options,
            runPhase,
            spawnAdapter: dependencies.spawnAdapter
          });
      result = await maybeRepairPhaseReport({
        phase,
        originalPrompt: prompt,
        result,
        projectRoot,
        paths,
        options,
        runPhase,
        spawnAdapter: dependencies.spawnAdapter,
        onRepairAttempt: ({ attempt, phaseTitle, warnings }) => {
          logger.step(phaseTitle);
          logger.warn(`Repair attempt ${attempt} triggered by: ${warnings.join("; ")}`);
        }
      });
      result = await maybeRunDeepRiskReview({
        phase,
        basePrompt: prompt,
        context,
        projectRoot,
        paths,
        options,
        projectMap: featureMap,
        result,
        status,
        runPhase,
        spawnAdapter: dependencies.spawnAdapter
      });
      result = await preservePreviousReportIfRetryFailed({
        phaseId: phase.id,
        result,
        previousReport: preservedReport,
        reportPath: phaseReportPath
      });

      await updatePhaseStatus(status, phase, result, options.strictReports);
      previousReports[phase.reportFile] = await safeReadReport(phaseReportPath, phase.title);
      if (phase.id !== "summary" && result.success) {
        detailPhaseRan = true;
      }
    }

    const extractedFindings = await assignFindingsToFeatures(
      featureMap.features,
      filterFindingsForReviewMode(
        extractFindings(previousReports["03-risk-and-bug-report.md"] ?? ""),
        options.reviewMode ?? "default"
      )
    );
    const validatedFindings = await validateFindingsEvidence(
      projectRoot,
      extractedFindings,
      allowedEvidencePathsFromPromptManifest(promptManifest, "risk-and-bug") ?? allowedEvidencePaths(featureMap.features),
      now
    );
    const baseline = await applyBaselineToFindings(projectRoot, options.outDir, validatedFindings, paths.runId, now);
    const findings = baseline.activeFindings;
    const suppressedFindings = baseline.suppressedFindings;
    const structuredReports = ANALYSIS_PHASES.map((phase) => extractStructuredPhaseReport(
      previousReports[phase.reportFile] ?? "",
      phase.id,
      phase.reportFile
    ));
    meta.findings = findings;
    meta.suppressedFindings = suppressedFindings;
    meta.exitCode = determineExitCode(options, meta.phases, previousReports["03-risk-and-bug-report.md"], findings, evidence);
    meta.completedAt = new Date().toISOString();
    await updateFeatureRecordsFromFindings(projectRoot, options.outDir, findings, paths.runId, now);
    await writeStructuredOutputs(paths, meta, findings, evidence, promptManifest, featuresPath, structuredReports, suppressedFindings);
    await appendGithubStepSummary(meta);
  } catch (error) {
    meta.exitCode = 1;
    throw error;
  } finally {
    meta.completedAt = new Date().toISOString();
    await writeMeta(paths.runDir, meta);
  }

  if (meta.exitCode === 0) {
    logger.info(`RepoVista audit completed: ${paths.runDir}`);
  } else {
    logger.warn(`RepoVista audit completed with exit code ${meta.exitCode}: ${paths.runDir}`);
  }

  return {
    paths,
    meta,
    exitCode: meta.exitCode
  };
}

async function resolveParallelMeta(
  projectRoot: string,
  options: AuditOptions,
  logger: Logger,
  currentMap?: Awaited<ReturnType<typeof createProjectMap>>
): Promise<ParallelExecutionMeta | undefined> {
  const mode = options.parallel ?? "off";
  if (mode === "off" || mode === 1) {
    return undefined;
  }
  let loaded = await loadProjectMap(projectRoot, options.outDir);
  if (!loaded && mode === "auto" && currentMap) {
    const mapPath = await saveProjectMap(projectRoot, options, currentMap);
    loaded = { map: currentMap, mapPath };
    logger.info(`Initialized RepoVista project map for parallel auto mode: ${mapPath}`);
  }
  if (!loaded) {
    throw new PreflightError("Parallel audit requires an initialized RepoVista project map. Run `repovista init` first or use `--parallel off`.");
  }
  const meta = createParallelExecutionMeta(loaded.map, loaded.mapPath, mode);
  for (const warning of meta.warnings) {
    logger.warn(warning);
  }
  if (meta.effectiveParallelism <= 1) {
    logger.warn("Parallel mode was requested, but RepoVista found only one useful shard. Continuing sequentially.");
  }
  if (meta.effectiveParallelism > 1) {
    logger.info(`Parallel mode: ${meta.effectiveParallelism} provider sessions for shardable phases.`);
  }
  return meta;
}

async function createRunPaths(projectRoot: string, options: AuditOptions, now: Date, createLogs: boolean): Promise<RunPaths> {
  if (options.resumeDir) {
    try {
      return await useExistingRunDirectory(projectRoot, options.resumeDir, createLogs, options.outDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PreflightError(`Could not resume RepoVista run: ${message}`);
    }
  }

  try {
    return await prepareRunDirectory(projectRoot, options.outDir, createRunId(now), createLogs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PreflightError(`Could not create RepoVista run: ${message}`);
  }
}

async function reusableReportForPreservation(
  phaseId: string,
  filePath: string,
  knownContent: string | undefined
): Promise<string | undefined> {
  if (knownContent && isReusablePhaseReport(phaseId, knownContent)) {
    return knownContent;
  }
  try {
    const content = await readReport(filePath);
    return isReusablePhaseReport(phaseId, content) ? content : undefined;
  } catch {
    return undefined;
  }
}

async function preservePreviousReportIfRetryFailed(input: {
  phaseId: string;
  result: ProviderRunResult;
  previousReport: string | undefined;
  reportPath: string;
}): Promise<ProviderRunResult> {
  if (!input.previousReport) {
    return input.result;
  }

  const retryFailure = await retryFailureReason(input.phaseId, input.result);
  if (!retryFailure) {
    return input.result;
  }

  await writeMarkdownReport(input.reportPath, input.previousReport);
  return {
    ...input.result,
    success: true,
    exitCode: 0,
    error: undefined,
    preservedPreviousReport: true,
    retryError: retryFailure,
    retryDurationMs: input.result.durationMs
  };
}

async function retryFailureReason(phaseId: string, result: ProviderRunResult): Promise<string | undefined> {
  if (!result.success) {
    return result.error ?? "Provider retry failed before producing a reusable report.";
  }
  try {
    const content = await readReport(result.reportPath);
    const quality = validateReportQuality(phaseId, content);
    return quality.passed ? undefined : `Provider retry report failed quality gates: ${quality.warnings.join(" ")}`;
  } catch (error) {
    return `Provider retry report could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadReusableReportsFromRun(runDir: string): Promise<Record<string, string>> {
  const reports: Record<string, string> = {};
  const [previousMeta, previousPromptManifest] = await Promise.all([
    readPreviousMeta(runDir),
    readPreviousPromptManifest(runDir)
  ]);
  for (const phase of ANALYSIS_PHASES) {
    const filePath = reportPath(runDir, phase.reportFile);
    try {
      const content = await readReport(filePath);
      const previousStatus = findPreviousPhaseStatus(previousMeta, phase.id);
      const manifestPhase = previousPromptManifest?.phases?.find((item) => item.phaseId === phase.id && item.reportFile === phase.reportFile);
      const quality = validateReportQuality(phase.id, content);
      if (
        previousStatus?.status === "success" &&
        previousStatus.qualityPassed !== false &&
        manifestPhase &&
        isReusablePhaseReport(phase.id, content) &&
        quality.passed
      ) {
        reports[phase.reportFile] = content;
      }
    } catch {
      // Missing or unusable reports simply are not reused.
    }
  }
  return reports;
}

async function readPreviousPromptManifest(runDir: string): Promise<{ phases?: Array<{ phaseId?: string; reportFile?: string }> } | undefined> {
  try {
    return JSON.parse(await readFile(reportPath(runDir, "prompt-manifest.json"), "utf8")) as { phases?: Array<{ phaseId?: string; reportFile?: string }> };
  } catch {
    return undefined;
  }
}

async function loadPromptGuidance(
  promptFile: string | undefined,
  projectRoot: string
): Promise<{ path?: string; content?: string }> {
  if (!promptFile) {
    return {};
  }
  const filePath = path.resolve(projectRoot, promptFile);
  try {
    return {
      path: filePath,
      content: await readFile(filePath, "utf8")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PreflightError(`Could not read --prompt-file ${promptFile}: ${message}`);
  }
}

function filterFindingsForReviewMode(findings: StructuredFinding[], mode: NonNullable<AuditOptions["reviewMode"]>): StructuredFinding[] {
  if (mode === "default") {
    return findings;
  }
  return findings.filter((finding) => {
    const category = `${finding.category ?? ""} ${finding.title} ${finding.problemRationale ?? ""}`.toLowerCase();
    if (mode === "deslopify") {
      return /maintainability|performance|duplication|complexity|dead|wrapper|simplif/.test(category);
    }
    if (mode === "security") {
      return /security|auth|authorization|authentication|secret|credential|token|injection|xss|csrf|ssrf|path|command|permission|supply/.test(category);
    }
    return /test|coverage|regression|fixture|assert|validation/.test(category);
  });
}

function determineExitCode(
  options: AuditOptions,
  phases: PhaseReportStatus[],
  riskReport: string | undefined,
  findings: StructuredFinding[],
  evidence: EvidencePack | undefined
): number {
  const hasCritical = findings.some((finding) => finding.severity === "critical") ||
    Boolean(!findings.length && riskReport && hasCriticalFindings(riskReport));
  if (options.ci && options.failOnCritical && hasCritical) {
    return 2;
  }
  if (phases.some((phase) => phase.status === "failed")) {
    return 1;
  }
  if (options.ci && evidence && hasFailedChecks(evidence)) {
    return 1;
  }
  return 0;
}

function auditCacheContext(
  options: AuditOptions,
  diffScope: DiffScope | undefined,
  compatibility: {
    providerVersion?: string;
    promptManifestFingerprint: string;
    effectiveModel?: string;
  }
): Record<string, unknown> {
  return {
    cacheSchema: 2,
    promptContextVersion: PROMPT_CONTEXT_VERSION,
    phaseSchemaVersion: PHASE_SCHEMA_VERSION,
    qualityGateVersion: QUALITY_GATES_VERSION,
    provider: options.provider ?? "codex",
    providerVersion: compatibility.providerVersion ?? null,
    promptManifestFingerprint: compatibility.promptManifestFingerprint,
    model: options.model ?? compatibility.effectiveModel ?? null,
    profile: options.profile ?? null,
    reasoning: options.reasoning ?? null,
    fastMode: Boolean(options.fastMode),
    sandbox: options.sandbox,
    language: options.language,
    phases: options.phases,
    runChecks: Boolean(options.runChecks),
    checkCommands: options.checkCommands,
    checkTimeoutSeconds: options.checkTimeoutSeconds,
    phaseTimeoutSeconds: options.phaseTimeoutSeconds,
    strictReports: Boolean(options.strictReports),
    repairReports: Boolean(options.repairReports),
    deepReview: Boolean(options.deepReview),
    reviewMode: options.reviewMode ?? "default",
    promptFile: options.promptFile ?? null,
    auditProfile: options.auditProfile ?? null,
    workspace: options.workspace ?? null,
    allWorkspaces: Boolean(options.allWorkspaces),
    since: options.since ?? null,
    diffRef: diffScope?.ref ?? null,
    diffFiles: diffScope?.fileStatuses?.map(cacheDiffFile) ?? diffScope?.changedFiles.map((path) => ({ path, status: "unknown" }))
  };
}

function promptManifestInputFingerprint(input: {
  options: AuditOptions;
  projectFiles: Array<{ relativePath: string; size: number; sha256?: string; mtimeMs?: number; scopeReason?: string }>;
  features: Array<{ id: string; title: string; kind: string; paths: string[]; ownedFiles: string[]; tests: string[]; validationCommands?: string[] }>;
  diffScope?: DiffScope;
  promptGuidance?: string;
}): string {
  return stableCacheFingerprint({
    promptContextVersion: PROMPT_CONTEXT_VERSION,
    phaseSchemaVersion: PHASE_SCHEMA_VERSION,
    qualityGateVersion: QUALITY_GATES_VERSION,
    language: input.options.language,
    phases: input.options.phases,
    reviewMode: input.options.reviewMode ?? "default",
    auditProfile: input.options.auditProfile ?? null,
    promptFileHash: input.promptGuidance ? stableCacheFingerprint(input.promptGuidance) : null,
    diffScope: input.diffScope ? {
      ref: input.diffScope.ref,
      files: input.diffScope.fileStatuses?.map(cacheDiffFile) ?? input.diffScope.changedFiles.map((path) => ({ path, status: "unknown" }))
    } : null,
    features: input.features.map((feature) => ({
      id: feature.id,
      title: feature.title,
      kind: feature.kind,
      paths: feature.paths,
      ownedFiles: feature.ownedFiles,
      tests: feature.tests,
      validationCommands: feature.validationCommands
    })),
    files: input.projectFiles.map((file) => ({
      path: file.relativePath,
      size: file.size,
      sha256: file.sha256 ?? null,
      mtimeMs: file.sha256 ? undefined : file.mtimeMs,
      reason: file.scopeReason
    }))
  });
}

function stableCacheFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function cacheDiffFile(file: NonNullable<DiffScope["fileStatuses"]>[number]): Pick<NonNullable<DiffScope["fileStatuses"]>[number], "path" | "status" | "previousPath"> {
  return {
    path: file.path,
    status: file.status,
    previousPath: file.previousPath
  };
}

export function hasCriticalFindings(report: string): boolean {
  const normalized = report.toLowerCase();
  if (/critical\s+findings?\s*\n\s*(?:-\s+)?(?:none|no critical|not detected)/i.test(report)) {
    return false;
  }
  return (
    normalized.includes("severity: critical") ||
    /(^|\n)#+\s+critical\s+findings?[\s\S]*?(^|\n)(?:-|\d+\.)\s+(?!none|no critical|not detected)/i.test(report)
  );
}
