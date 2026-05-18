import { allowedEvidencePaths, collectAuditDiffScope, createInitialMeta, reportFolderName } from "./audit-context.js";
import { writeStructuredOutputs } from "./audit-outputs.js";
import { applyBaselineToFindings } from "./baseline.js";
import { projectScanFingerprint, updateAuditCache } from "./cache.js";
import { PreflightError } from "./errors.js";
import { collectEvidence, type EvidenceDependencies, hasFailedChecks } from "./evidence.js";
import { validateFindingsEvidence } from "./evidence-validation.js";
import { extractFindings } from "./findings.js";
import { createProjectInventory } from "./inventory.js";
import { Logger } from "./logger.js";
import { extractStructuredPhaseReport } from "./phase-schema.js";
import { addPromptManifestPhase, createPromptManifest } from "./prompt-manifest.js";
import { ANALYSIS_PHASES, type PromptContext } from "./prompts.js";
import { canParallelizePhase, runParallelPhase, runSinglePhase } from "./phase-runner.js";
import { runPreflight, type PreflightDependencies } from "./preflight.js";
import { createParallelExecutionMeta, createProjectMap, loadProjectMap } from "./project-map.js";
import { scanProject } from "./project-scan.js";
import { getReportProvider } from "./providers/index.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { applyAuditProfile } from "./profiles.js";
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
import type {
  AuditMeta,
  AuditOptions,
  EvidencePack,
  ParallelExecutionMeta,
  PhaseReportStatus,
  RunPaths,
  StructuredFinding
} from "./types.js";

export interface AuditDependencies extends PreflightDependencies, EvidenceDependencies {
  cwd?: string;
  now?: Date;
  version?: string;
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

  const meta = createInitialMeta(projectRoot, paths, options, version, now);
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
    const scanFingerprint = projectScanFingerprint(projectScan.files);
    meta.cache = await updateAuditCache({
      projectRoot,
      outDir: options.outDir,
      runDir: paths.runDir,
      runId: paths.runId,
      scanFingerprint,
      fileCount: projectScan.files.length,
      enabled: Boolean(options.incremental),
      now
    });
    if (meta.cache.enabled && meta.cache.hit) {
      logger.info(`Incremental scan cache hit. Previous matching run: ${meta.cache.previousRunId ?? "unknown"}.`);
    }
    const incrementalReports = meta.cache.enabled && meta.cache.hit && meta.cache.previousRunDir
      ? await loadReusableReportsFromRun(meta.cache.previousRunDir)
      : {};

    logger.step("Creating project inventory");
    const provider = getReportProvider(options.provider ?? "codex");
    const inventory = await createProjectInventory(projectRoot, {
      outDir: options.outDir,
      includes: options.includes,
      ignores: options.ignores,
      ai: {
        provider: options.provider ?? "codex",
        displayName: provider.displayName,
        executable: provider.executable,
        model: options.model,
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
    const featuresPath = reportPath(paths.runDir, "features.json");
    await writeJsonFile(featuresPath, {
      schemaVersion: 1,
      runId: paths.runId,
      since: diffScope,
      features: featureMap.features
    });
    const promptManifest = createPromptManifest(paths.runId, now, featureMap.features, diffScope);

    const selectedPhases = expandSelectedPhases(options.phases ?? []);
    const runPhase = dependencies.runProvider ?? dependencies.runCodex ?? runProviderPhase;
    const parallel = await resolveParallelMeta(projectRoot, options, logger);
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

      const phaseReportPath = reportPath(paths.runDir, phase.reportFile);
      const context: PromptContext = {
        language: options.language,
        projectRoot,
        reportFolderName: reportFolderName(options.outDir),
        inventoryMarkdown: inventory.markdown,
        previousReports,
        since: diffScope,
        features: featureMap.features
      };
      const prompt = phase.buildPrompt(context);
      await addPromptManifestPhase(promptManifest, {
        phaseId: phase.id,
        reportFile: phase.reportFile,
        prompt,
        inventoryPath,
        previousReports,
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
        spawnAdapter: dependencies.spawnAdapter
      });

      await updatePhaseStatus(status, phase, result, options.strictReports);
      previousReports[phase.reportFile] = await safeReadReport(phaseReportPath, phase.title);
      if (phase.id !== "summary" && result.success) {
        detailPhaseRan = true;
      }
    }

    const extractedFindings = extractFindings(previousReports["03-risk-and-bug-report.md"] ?? "");
    const validatedFindings = await validateFindingsEvidence(
      projectRoot,
      extractedFindings,
      allowedEvidencePaths(featureMap.features),
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
    await writeStructuredOutputs(paths, meta, findings, evidence, promptManifest, featuresPath, structuredReports, suppressedFindings);
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
  logger: Logger
): Promise<ParallelExecutionMeta | undefined> {
  const mode = options.parallel ?? "off";
  if (mode === "off" || mode === 1) {
    return undefined;
  }
  const loaded = await loadProjectMap(projectRoot, options.outDir);
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

async function loadReusableReportsFromRun(runDir: string): Promise<Record<string, string>> {
  const reports: Record<string, string> = {};
  for (const phase of ANALYSIS_PHASES) {
    const filePath = reportPath(runDir, phase.reportFile);
    try {
      const content = await readReport(filePath);
      if (isReusablePhaseReport(phase.id, content)) {
        reports[phase.reportFile] = content;
      }
    } catch {
      // Missing or unusable reports simply are not reused.
    }
  }
  return reports;
}

function determineExitCode(
  options: AuditOptions,
  phases: PhaseReportStatus[],
  riskReport: string | undefined,
  findings: StructuredFinding[],
  evidence: EvidencePack | undefined
): number {
  const hasCritical = findings.some((finding) => finding.severity === "critical") ||
    Boolean(riskReport && hasCriticalFindings(riskReport));
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
