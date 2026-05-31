import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { allowedEvidencePaths, collectAuditDiffScope, createInitialMeta, reportFolderName } from "./audit-context.js";
import { createAuditSettingsSummary, createEffectiveAuditSettings } from "./audit-settings.js";
import { prepareAuditSnapshot, type PreparedAuditSnapshot } from "./audit-snapshot.js";
import { writeStructuredOutputs } from "./audit-outputs.js";
import { applyBaselineToFindings } from "./baseline.js";
import { projectScanFingerprint, updateAuditCache, type FeatureCacheEntry, type PhaseCacheEntry, type ShardCacheEntry } from "./cache.js";
import { maybeRunDeepRiskReview } from "./deep-review.js";
import { AuditCancelledError, PreflightError } from "./errors.js";
import { collectEvidence, type CommandRunner, type EvidenceDependencies, hasFailedChecks } from "./evidence.js";
import { validateFindingsEvidence } from "./evidence-validation.js";
import { assignFindingsToFeatures, syncFeatureRecords, updateFeatureRecordsFromFindings } from "./feature-state.js";
import { extractFindings } from "./findings.js";
import {
  collectRepositoryGitSnapshot,
  createInitialRepositoryDriftState,
  detectRepositoryDrift,
  gitSnapshotFromEvidence,
  primaryRepositoryDriftWarning
} from "./git-drift.js";
import { prepareGithubSource } from "./github-source.js";
import { createProjectInventory } from "./inventory.js";
import { Logger, type AuditProviderProgress, type LoggerSink } from "./logger.js";
import { PHASE_SCHEMA_VERSION, extractStructuredPhaseReport } from "./phase-schema.js";
import { addPromptManifestPhase, allowedEvidencePathsFromPromptManifest, createPromptManifest } from "./prompt-manifest.js";
import { ANALYSIS_PHASES, PROMPT_CONTEXT_VERSION, type PhaseDefinition, type PromptContext } from "./prompts.js";
import { canParallelizePhase, runParallelPhase, runSinglePhase, type ReusableShardReport } from "./phase-runner.js";
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
import { combineLoggerSinks, createRunStatusRecorder, type RepoVistaRunStatusRecorder } from "./run-status.js";
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
  ProjectFileSummary,
  PromptManifest,
  ProviderRunRequest,
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
  abortSignal?: AbortSignal;
  loggerSink?: LoggerSink;
  statusFile?: string;
}

export interface AuditResult {
  paths: RunPaths;
  meta: AuditMeta;
  exitCode: number;
}

type RunPhaseFunction = typeof runProviderPhase;

export async function runAudit(options: AuditOptions, dependencies: AuditDependencies = {}): Promise<AuditResult> {
  const runStartedAtMs = Date.now();
  options = applyAuditProfile(options);
  options = applyBugFindingsMode(options);
  if (options.githubRepo && !options.runChecksExplicit) {
    options = {
      ...options,
      runChecks: false
    };
  }
  const outputProjectRoot = dependencies.cwd ?? process.cwd();
  const now = dependencies.now ?? new Date();
  const version = dependencies.version ?? "0.0.0";
  let logger = new Logger(options.progress, dependencies.loggerSink);
  const abortSignal = dependencies.abortSignal;
  const createLogs = options.keepLogs || options.json;
  const paths = await createRunPaths(outputProjectRoot, options, now, createLogs);
  throwIfCancelled(abortSignal);
  const githubSource = await prepareGithubSource(outputProjectRoot, paths.outRoot, options, {
    runCommand: dependencies.runCommand,
    now
  });
  let snapshot: PreparedAuditSnapshot | undefined;
  let projectRoot = githubSource?.cloneDir ?? outputProjectRoot;
  if (githubSource) {
    logger.info(`GitHub source: ${githubSource.repository}@${githubSource.commit.slice(0, 12)} (${githubSource.cloneDir})`);
    if (!options.runChecksExplicit) {
      logger.info("Local check commands are disabled by default for --github-repo. Use --run-checks to run checks inside the cloned repository.");
    }
  }
  if (options.snapshot && !options.resumeDir) {
    snapshot = await prepareAuditSnapshot(projectRoot, paths.runDir, [options.outDir], now);
    projectRoot = snapshot.meta.analysisRoot;
    logger.info(`Snapshot audit enabled at ${snapshot.meta.commit?.slice(0, 12) ?? "HEAD"}: ${snapshot.meta.analysisRoot}`);
    for (const warning of snapshot.meta.warnings) {
      logger.warn(warning);
    }
  } else if (options.snapshot && options.resumeDir) {
    logger.warn("Snapshot audit was requested with --resume; the existing run directory will be resumed without creating a new snapshot.");
  }
  const provider = getReportProvider(options.provider ?? "codex");
  const effectiveModel = options.model ?? await (dependencies.resolveProviderDefaultModel ?? resolveProviderDefaultModel)(provider.id, options);
  const effectiveSettings = createEffectiveAuditSettings(options, provider, effectiveModel);
  options = {
    ...options,
    model: options.model ?? effectiveSettings.modelArgument,
    reasoning: options.reasoning ?? effectiveSettings.reasoning
  };
  const workspaceScope = await resolveWorkspaceScope(projectRoot, options);
  options = {
    ...options,
    includes: workspaceIncludes(options, workspaceScope)
  };

  const meta = createInitialMeta(projectRoot, paths, options, version, now, {
    model: effectiveSettings.model,
    reasoning: effectiveSettings.reasoning,
    profile: effectiveSettings.providerProfile
  });
  if (githubSource) {
    meta.source = githubSource;
  }
  meta.workspace = workspaceScope;
  if (snapshot) {
    meta.snapshot = snapshot.meta;
  }
  const statusRecorder: RepoVistaRunStatusRecorder = createRunStatusRecorder({
    projectRoot,
    paths,
    meta,
    options,
    statusFile: dependencies.statusFile
  });
  logger = new Logger(options.progress, combineLoggerSinks(dependencies.loggerSink, statusRecorder.sink));
  logger.auditSettings(createAuditSettingsSummary(effectiveSettings));
  const previousReports: Record<string, string> = {};
  const previousMeta = options.resumeDir ? await readPreviousMeta(paths.runDir) : undefined;
  let repositoryDriftMonitor: RepositoryDriftMonitor | undefined;

  try {
    throwIfCancelled(abortSignal);
    if (options.resumeDir) {
      await loadExistingReports(paths, previousReports, meta.phases, previousMeta);
    }

    logger.step("Preflight checks");
    const preflight = await runPreflight(projectRoot, paths.runDir, options, dependencies, { outputProjectRoot });
    throwIfCancelled(abortSignal);
    meta.preflight = preflight;
    for (const warning of preflight.warnings) {
      logger.warn(warning);
    }

    logger.step("Collecting evidence pack");
    const evidence = await collectEvidence(projectRoot, options, dependencies);
    throwIfCancelled(abortSignal);
    meta.evidence = evidence;
    meta.repositoryDrift = createInitialRepositoryDriftState(gitSnapshotFromEvidence(evidence, undefined, [options.outDir]));
    repositoryDriftMonitor = startRepositoryDriftMonitor(projectRoot, meta, logger, dependencies.runCommand);
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
    throwIfCancelled(abortSignal);
    const promptGuidance = await loadPromptGuidance(options.promptFile, outputProjectRoot);

    logger.step("Creating project inventory");
    const inventoryStartedAtMs = Date.now();
    const inventory = await createProjectInventory(projectRoot, {
      outDir: options.outDir,
      includes: options.includes,
      ignores: options.ignores,
      ai: {
        provider: options.provider ?? "codex",
        displayName: provider.displayName,
        executable: provider.executable,
        model: effectiveSettings.model,
        profile: effectiveSettings.providerProfile,
        reasoning: effectiveSettings.reasoning,
        fastMode: options.fastMode,
        sandbox: options.sandbox
      },
      evidence,
      now,
      scan: projectScan
    });
    recordReportDuration(meta, "00-inventory.md", Date.now() - inventoryStartedAtMs);
    throwIfCancelled(abortSignal);
    for (const warning of inventory.warnings) {
      logger.warn(warning);
    }

    const inventoryPath = reportPath(paths.runDir, "00-inventory.md");
    await writeMarkdownReport(inventoryPath, inventory.markdown);
    previousReports["00-inventory.md"] = inventory.markdown;

    const featureMap = await createProjectMap(projectRoot, options, now, diffScope, projectScan);
    const featureStateDir = await syncFeatureRecords(outputProjectRoot, options.outDir, featureMap.features, paths.runId, now);
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
    const selectedPhases = expandSelectedPhases(options.phases ?? []);
    const runPhase = dependencies.runProvider ?? dependencies.runCodex ?? runProviderPhase;
    const parallel = await resolveParallelMeta(projectRoot, outputProjectRoot, paths, options, logger, featureMap);
    meta.parallel = parallel;
    const phaseFingerprints = buildPhaseCacheEntries(projectScan.files, options, {
      reuseKey,
      promptManifestFingerprint,
      effectiveModel
    });
    const featureFingerprints = buildFeatureCacheEntries(projectScan.files, featureMap.features);
    const shardFingerprints = buildShardCacheEntries(projectScan.files, parallel);
    const scanFingerprint = projectScanFingerprint(projectScan.files, {
      reuseKey,
      providerVersion: evidence.aiProvider.version,
      promptManifestFingerprint,
      promptContextVersion: PROMPT_CONTEXT_VERSION,
      phaseSchemaVersion: PHASE_SCHEMA_VERSION,
      qualityGateVersion: QUALITY_GATES_VERSION
    });
    meta.cache = await updateAuditCache({
      projectRoot: outputProjectRoot,
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
      phaseFingerprints,
      featureFingerprints,
      shardFingerprints,
      enabled: Boolean(options.incremental),
      now
    });
    if (meta.cache.enabled && meta.cache.hit) {
      logger.info(`Incremental scan cache hit. Previous matching run: ${meta.cache.previousRunId ?? "unknown"}.`);
    } else if (meta.cache.enabled && meta.cache.mismatchReasons?.length) {
      logger.info(`Incremental cache not reused: ${meta.cache.mismatchReasons.join("; ")}.`);
    }
    const phaseReuseHits = meta.cache.phaseReuse?.filter((entry) => entry.hit).length ?? 0;
    const shardReuseHits = meta.cache.shardReuse?.filter((entry) => entry.hit).length ?? 0;
    if (meta.cache.enabled && !meta.cache.hit && (phaseReuseHits || shardReuseHits)) {
      logger.info(`Incremental fine-grained reuse available: ${phaseReuseHits} phase(s), ${shardReuseHits} shard(s).`);
    }
    const incrementalReports = meta.cache.enabled && meta.cache.hit && meta.cache.previousRunDir
      ? await loadReusableReportsFromRun(meta.cache.previousRunDir)
      : await loadReusableReportsFromCache(meta.cache);
    const incrementalShardReports = reusableShardReportsFromCache(meta.cache);
    const providerConcurrency = resolveProviderConcurrency(options, parallel);
    if (providerConcurrency > 1) {
      logger.info(`Provider concurrency budget: ${providerConcurrency} session(s) shared by phases and shards.`);
    }
    await runPhaseDag({
      projectRoot,
      inventoryMarkdown: inventory.markdown,
      inventoryPath,
      featuresPath,
      paths,
      options,
      previousReports,
      previousMeta,
      meta,
      promptManifest,
      promptFilePath: promptGuidance.path,
      promptGuidance: promptGuidance.content,
      projectFiles: projectScan.files,
      omittedProjectFileCount: projectScan.omittedFileCount,
      diffScope,
      featureMap,
      incrementalReports,
      incrementalShardReports,
      selectedPhases,
      parallel,
      phaseConcurrency: resolvePhaseConcurrency(providerConcurrency),
      runPhase: limitRunPhaseConcurrency(runPhase, providerConcurrency, logger),
      spawnAdapter: dependencies.spawnAdapter,
      abortSignal,
      logger,
      recordReportDuration,
      checkRepositoryDrift: async () => {
        await repositoryDriftMonitor?.checkNow();
      }
    });
    sortPromptManifestPhases(promptManifest);

    throwIfCancelled(abortSignal);
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
    const baseline = await applyBaselineToFindings(outputProjectRoot, options.outDir, validatedFindings, paths.runId, now);
    const findings = baseline.activeFindings;
    const suppressedFindings = baseline.suppressedFindings;
    meta.findings = findings;
    meta.suppressedFindings = suppressedFindings;
    await repositoryDriftMonitor?.checkNow();
    meta.exitCode = determineExitCode(options, meta, previousReports["03-risk-and-bug-report.md"], findings, evidence);
    await appendRunQualityStatus(paths, meta, previousReports);
    const structuredReports = ANALYSIS_PHASES
      .filter((phase) => (previousReports[phase.reportFile] ?? "").trim())
      .map((phase) => extractStructuredPhaseReport(
        previousReports[phase.reportFile] ?? "",
        phase.id,
        phase.reportFile
      ));
    completeRunTiming(meta, runStartedAtMs);
    await updateFeatureRecordsFromFindings(outputProjectRoot, options.outDir, findings, paths.runId, now);
    await writeStructuredOutputs(paths, meta, findings, evidence, promptManifest, featuresPath, structuredReports, suppressedFindings, outputProjectRoot);
    await appendGithubStepSummary(meta);
  } catch (error) {
    if (isAuditCancelled(error, abortSignal)) {
      meta.exitCode = 130;
      logger.warn("RepoVista audit cancelled. Running provider sessions were asked to stop.");
    } else {
      meta.exitCode = 1;
      throw error;
    }
  } finally {
    await repositoryDriftMonitor?.checkNow();
    repositoryDriftMonitor?.stop();
    await snapshot?.cleanup();
    completeRunTiming(meta, runStartedAtMs);
    await writeMeta(paths.runDir, meta);
    await statusRecorder.finish(meta.exitCode);
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

function applyBugFindingsMode(options: AuditOptions): AuditOptions {
  if (!options.bugFindingsOnly) {
    return options;
  }
  return {
    ...options,
    phases: ["risk-and-bug"],
    deepReview: false
  };
}

interface PhaseDagInput {
  projectRoot: string;
  inventoryMarkdown: string;
  inventoryPath: string;
  featuresPath: string;
  paths: RunPaths;
  options: AuditOptions;
  previousReports: Record<string, string>;
  previousMeta?: AuditMeta;
  meta: AuditMeta;
  promptManifest: PromptManifest;
  promptFilePath?: string;
  promptGuidance?: string;
  projectFiles: ProjectFileSummary[];
  omittedProjectFileCount: number;
  diffScope?: DiffScope;
  featureMap: Awaited<ReturnType<typeof createProjectMap>>;
  incrementalReports: Record<string, string>;
  incrementalShardReports: Record<string, Record<string, ReusableShardReport>>;
  selectedPhases: Set<string> | undefined;
  parallel?: ParallelExecutionMeta;
  phaseConcurrency: number;
  runPhase: RunPhaseFunction;
  spawnAdapter?: SpawnAdapter;
  abortSignal?: AbortSignal;
  logger: Logger;
  recordReportDuration(meta: AuditMeta, reportFile: string, durationMs: number | undefined): void;
  checkRepositoryDrift?: () => Promise<void>;
}

async function runPhaseDag(input: PhaseDagInput): Promise<void> {
  const pending = new Set(ANALYSIS_PHASES.map((phase) => phase.id));
  const completed = new Set<string>();
  const running = new Map<string, Promise<void>>();
  const knownPhaseIds = new Set(ANALYSIS_PHASES.map((phase) => phase.id));
  const state = { detailPhaseRan: false };

  while (pending.size || running.size) {
    throwIfCancelled(input.abortSignal);
    let started = false;

    for (const phase of ANALYSIS_PHASES) {
      if (running.size >= input.phaseConcurrency) {
        break;
      }
      if (!pending.has(phase.id) || !phaseDependenciesComplete(phase, completed, knownPhaseIds)) {
        continue;
      }
      pending.delete(phase.id);
      const task = runPhaseWithLifecycle(phase, input, state)
        .then(() => {
          completed.add(phase.id);
        })
        .finally(() => {
          running.delete(phase.id);
        });
      running.set(phase.id, task);
      started = true;
    }

    if (!running.size) {
      if (pending.size) {
        throw new PreflightError(`Could not resolve RepoVista phase dependencies: ${Array.from(pending).join(", ")}.`);
      }
      return;
    }

    try {
      await Promise.race(running.values());
    } catch (error) {
      await Promise.allSettled(running.values());
      throw error;
    }

    if (!started) {
      continue;
    }
  }
}

async function runPhaseWithLifecycle(
  phase: PhaseDefinition,
  input: PhaseDagInput,
  state: { detailPhaseRan: boolean }
): Promise<void> {
  throwIfCancelled(input.abortSignal);
  const status = phaseStatus(input.meta.phases, phase);
  const previousStatus = findPreviousPhaseStatus(input.previousMeta, phase.id);
  if (!input.options.resumeDir && !input.selectedPhases && input.incrementalReports[phase.reportFile]) {
    const phaseReportPath = reportPath(input.paths.runDir, phase.reportFile);
    await writeMarkdownReport(phaseReportPath, input.incrementalReports[phase.reportFile]);
    input.previousReports[phase.reportFile] = input.incrementalReports[phase.reportFile];
    await markSkippedOrPreserved(status, phase, input.paths, input.previousReports);
    status.durationMs ??= 0;
    input.recordReportDuration(input.meta, phase.reportFile, status.totalDurationMs ?? status.durationMs);
    input.logger.info(`Incremental cache reused ${phase.reportFile}.`);
    return;
  }

  const shouldRun = await shouldRunPhase(phase, status, input.paths, input.options, input.selectedPhases, state.detailPhaseRan);
  if (!shouldRun) {
    await markSkippedOrPreserved(status, phase, input.paths, input.previousReports);
    input.recordReportDuration(input.meta, phase.reportFile, status.durationMs);
    return;
  }

  const phaseStartedAtMs = Date.now();
  input.logger.phaseStarted({ id: phase.id, title: phase.title });
  try {
    status.status = "pending";
    status.error = undefined;
    status.repairAttempts = undefined;

    const phaseReportPath = reportPath(input.paths.runDir, phase.reportFile);
    const preservedReport = await reusableReportForPreservation(phase.id, phaseReportPath, input.previousReports[phase.reportFile]);
    const previousReportsSnapshot = { ...input.previousReports };
    const context: PromptContext = {
      language: input.options.language,
      projectRoot: input.projectRoot,
      reportFolderName: reportFolderName(input.options.outDir),
      inventoryMarkdown: input.inventoryMarkdown,
      previousReports: previousReportsSnapshot,
      since: input.diffScope,
      features: input.featureMap.features,
      reviewMode: input.options.reviewMode ?? "default",
      bugFindingsOnly: Boolean(input.options.bugFindingsOnly),
      additionalGuidance: input.promptGuidance
    };
    const prompt = phase.buildPrompt(context);
    await addPromptManifestPhase(input.promptManifest, {
      phaseId: phase.id,
      reportFile: phase.reportFile,
      prompt,
      inventoryPath: input.inventoryPath,
      previousReports: previousReportsSnapshot,
      promptFilePath: input.promptFilePath,
      featureMapPath: input.featuresPath,
      projectFiles: input.projectFiles,
      omittedProjectFileCount: input.omittedProjectFileCount
    });
    let result = input.parallel && input.parallel.effectiveParallelism > 1 && canParallelizePhase(phase)
      ? await runParallelPhase({
          phase,
          prompt,
          context,
          projectRoot: input.projectRoot,
          paths: input.paths,
          options: input.options,
          parallel: input.parallel,
          runPhase: input.runPhase,
          spawnAdapter: input.spawnAdapter,
          abortSignal: input.abortSignal,
          resume: Boolean(input.options.resumeDir),
          status,
          previousStatus,
          reusableShards: input.incrementalShardReports[phase.id]
        })
      : await runSinglePhase({
          phase,
          prompt,
          projectRoot: input.projectRoot,
          phaseReportPath,
          paths: input.paths,
          options: input.options,
          runPhase: input.runPhase,
          spawnAdapter: input.spawnAdapter,
          abortSignal: input.abortSignal
        });
    throwIfCancelled(input.abortSignal);
    result = await maybeRepairPhaseReport({
      phase,
      originalPrompt: prompt,
      result,
      projectRoot: input.projectRoot,
      paths: input.paths,
      options: input.options,
      runPhase: input.runPhase,
      spawnAdapter: input.spawnAdapter,
      abortSignal: input.abortSignal,
      onRepairAttempt: ({ attempt, phaseTitle, warnings }) => {
        input.logger.step(phaseTitle);
        input.logger.warn(`Repair attempt ${attempt} triggered by: ${warnings.join("; ")}`);
      }
    });
    throwIfCancelled(input.abortSignal);
    result = await maybeRunDeepRiskReview({
      phase,
      basePrompt: prompt,
      context,
      projectRoot: input.projectRoot,
      paths: input.paths,
      options: input.options,
      projectMap: input.featureMap,
      result,
      status,
      runPhase: input.runPhase,
      spawnAdapter: input.spawnAdapter,
      abortSignal: input.abortSignal
    });
    throwIfCancelled(input.abortSignal);
    result = await preservePreviousReportIfRetryFailed({
      phaseId: phase.id,
      result,
      previousReport: preservedReport,
      reportPath: phaseReportPath
    });

    await updatePhaseStatus(status, phase, result, input.options.strictReports);
    status.totalDurationMs = Math.max(status.durationMs ?? 0, Date.now() - phaseStartedAtMs);
    input.recordReportDuration(input.meta, phase.reportFile, status.durationMs);
    input.previousReports[phase.reportFile] = await safeReadReport(phaseReportPath, phase.title);
    if (phase.id !== "summary" && result.success) {
      state.detailPhaseRan = true;
    }
    const finalPhaseStatus = input.meta.phases.find((item) => item.id === phase.id)?.status;
    input.logger.phaseFinished({
      id: phase.id,
      title: phase.title,
      status: finalPhaseStatus === "success" ? "done" : "failed",
      error: finalPhaseStatus === "failed" ? status.error : undefined
    });
    await input.checkRepositoryDrift?.();
  } catch (error) {
    status.totalDurationMs = Math.max(status.durationMs ?? 0, Date.now() - phaseStartedAtMs);
    input.logger.phaseFinished({
      id: phase.id,
      title: phase.title,
      status: isAuditCancelled(error, input.abortSignal) ? "cancelled" : "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function phaseDependenciesComplete(
  phase: PhaseDefinition,
  completed: Set<string>,
  knownPhaseIds: Set<string>
): boolean {
  return phase.dependencies.every((dependency) => !knownPhaseIds.has(dependency) || completed.has(dependency));
}

function resolveProviderConcurrency(options: AuditOptions, parallel: ParallelExecutionMeta | undefined): number {
  const mode = options.parallel ?? "off";
  if (mode === "off") {
    return 1;
  }
  if (typeof mode === "number") {
    return Math.max(1, Math.min(5, Math.floor(mode)));
  }
  return Math.max(2, Math.min(5, parallel?.effectiveParallelism ?? 2));
}

function resolvePhaseConcurrency(providerConcurrency: number): number {
  return providerConcurrency > 1 ? 2 : 1;
}

interface RepositoryDriftMonitor {
  checkNow(): Promise<void>;
  stop(): void;
}

function startRepositoryDriftMonitor(
  projectRoot: string,
  meta: AuditMeta,
  logger: Logger,
  runCommand?: CommandRunner
): RepositoryDriftMonitor | undefined {
  const initial = meta.repositoryDrift?.initial;
  if (!initial?.available) {
    return undefined;
  }
  let stopped = false;
  let checking = false;
  let inFlight: Promise<void> | undefined;
  let lastWarning = primaryRepositoryDriftWarning(meta.repositoryDrift);

  const checkNow = async () => {
    if (stopped) {
      return;
    }
    if (checking) {
      await inFlight;
      return;
    }
    checking = true;
    inFlight = (async () => {
      try {
        const current = await collectRepositoryGitSnapshot(projectRoot, runCommand, undefined, [meta.options.outDir]);
        const next = detectRepositoryDrift(initial, current, meta.repositoryDrift);
        meta.repositoryDrift = next;
        const warning = primaryRepositoryDriftWarning(next);
        if (warning && warning !== lastWarning) {
          lastWarning = warning;
          logger.warn(warning);
        }
      } catch {
        // Repository drift is advisory; never fail an audit because the signal could not be refreshed.
      } finally {
        checking = false;
        inFlight = undefined;
      }
    })();
    await inFlight;
  };

  const timer = setInterval(() => {
    void checkNow();
  }, 10_000);
  timer.unref();

  return {
    checkNow,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}

function limitRunPhaseConcurrency(runPhase: RunPhaseFunction, concurrency: number, logger: Logger): RunPhaseFunction {
  const maxConcurrency = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<{ enter: () => void; abort?: () => void }> = [];

  const acquire = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AuditCancelledError(abortReason(signal)));
      return;
    }
    let entry: { enter: () => void; abort?: () => void };
    const onAbort = () => {
      const index = queue.indexOf(entry);
      if (index >= 0) {
        queue.splice(index, 1);
      }
      reject(new AuditCancelledError(signal ? abortReason(signal) : "RepoVista audit was cancelled."));
    };
    const enter = () => {
      signal?.removeEventListener("abort", onAbort);
      active += 1;
      resolve();
    };
    if (active < maxConcurrency) {
      enter();
      return;
    }
    entry = { enter, abort: onAbort };
    signal?.addEventListener("abort", onAbort, { once: true });
    queue.push(entry);
  });

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) {
      next.enter();
    }
  };

  return async (request: ProviderRunRequest, spawnAdapter?: SpawnAdapter): Promise<ProviderRunResult> => {
    const progress = providerProgressForRequest(request);
    logger.providerQueued(progress);
    await acquire(request.abortSignal);
    try {
      logger.providerStarted(progress);
      const result = await runPhase({
        ...request,
        onProgress: (event) => {
          request.onProgress?.(event);
          logger.providerEvent({
            providerId: event.phaseId,
            parentPhaseId: progress.parentPhaseId,
            type: event.kind,
            at: event.at,
            pid: event.kind === "spawned" ? event.pid : undefined,
            stream: event.kind === "output" ? event.stream : undefined,
            bytes: event.kind === "output" ? event.bytes : undefined,
            exitCode: event.kind === "closed" ? event.exitCode : undefined,
            signal: event.kind === "closed" ? event.signal : undefined
          });
        }
      }, spawnAdapter);
      logger.providerFinished({
        ...progress,
        status: result.success ? "done" : request.abortSignal?.aborted ? "cancelled" : "failed",
        durationMs: result.durationMs,
        error: result.error
      });
      return result;
    } catch (error) {
      logger.providerFinished({
        ...progress,
        status: request.abortSignal?.aborted ? "cancelled" : "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      release();
    }
  };
}

function providerProgressForRequest(request: ProviderRunRequest): AuditProviderProgress {
  const parentPhaseId = parentPhaseIdForProviderRun(request.phaseId);
  return {
    id: request.phaseId,
    title: request.phaseTitle,
    parentPhaseId,
    kind: providerRunKind(request.phaseId, parentPhaseId)
  };
}

function parentPhaseIdForProviderRun(phaseId: string): string {
  const phaseIds = ANALYSIS_PHASES.map((phase) => phase.id).sort((left, right) => right.length - left.length);
  return phaseIds.find((id) => phaseId === id || phaseId.startsWith(`${id}-`)) ?? phaseId;
}

function providerRunKind(phaseId: string, parentPhaseId: string): AuditProviderProgress["kind"] {
  if (phaseId.includes("-repair-")) {
    return "repair";
  }
  if (phaseId.includes("-deep-")) {
    return "deep-review";
  }
  if (phaseId === `${parentPhaseId}-synthesis`) {
    return "synthesis";
  }
  if (phaseId.startsWith(`${parentPhaseId}-thread-`)) {
    return "shard";
  }
  return "phase";
}

function sortPromptManifestPhases(manifest: PromptManifest): void {
  const order = new Map(ANALYSIS_PHASES.map((phase, index) => [phase.id, index]));
  manifest.phases.sort((left, right) =>
    (order.get(left.phaseId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.phaseId) ?? Number.MAX_SAFE_INTEGER) ||
    left.phaseId.localeCompare(right.phaseId)
  );
}

async function resolveParallelMeta(
  analysisProjectRoot: string,
  outputProjectRoot: string,
  paths: RunPaths,
  options: AuditOptions,
  logger: Logger,
  currentMap?: Awaited<ReturnType<typeof createProjectMap>>
): Promise<ParallelExecutionMeta | undefined> {
  const mode = options.parallel ?? "off";
  if (mode === "off" || mode === 1) {
    return undefined;
  }
  if (options.githubRepo && currentMap) {
    const mapPath = reportPath(paths.runDir, "project-map.json");
    await writeJsonFile(mapPath, currentMap);
    logger.info(`Recorded GitHub source project map for this run: ${mapPath}`);
    const meta = createParallelExecutionMeta(currentMap, mapPath, mode);
    emitParallelWarnings(meta, logger);
    return meta;
  }
  let loaded = await loadProjectMap(outputProjectRoot, options.outDir);
  if (!loaded && mode === "auto" && currentMap) {
    const mapPath = await saveProjectMap(outputProjectRoot, options, currentMap);
    loaded = { map: currentMap, mapPath };
    logger.info(`Initialized RepoVista project map for parallel auto mode: ${mapPath}`);
  }
  if (!loaded) {
    throw new PreflightError("Parallel audit requires an initialized RepoVista project map. Run `repovista init` first or use `--parallel off`.");
  }
  if (loaded.map.projectRoot !== analysisProjectRoot && currentMap) {
    const mapPath = await saveProjectMap(outputProjectRoot, options, currentMap);
    loaded = { map: currentMap, mapPath };
    logger.info(`Refreshed RepoVista project map for current analysis source: ${mapPath}`);
  }
  const meta = createParallelExecutionMeta(loaded.map, loaded.mapPath, mode);
  emitParallelWarnings(meta, logger);
  return meta;
}

function emitParallelWarnings(meta: ParallelExecutionMeta, logger: Logger): void {
  for (const warning of meta.warnings) {
    logger.warn(warning);
  }
  if (meta.effectiveParallelism <= 1) {
    logger.warn("Parallel mode was requested, but RepoVista found only one useful shard. Shard parallelism will use one shard; independent phases can still share the provider concurrency budget.");
  }
  if (meta.effectiveParallelism > 1) {
    logger.info(`Shard parallelism: ${meta.effectiveParallelism} provider session(s) for shardable phases.`);
  }
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

function recordReportDuration(meta: AuditMeta, reportFile: string, durationMs: number | undefined): void {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  meta.reportDurations ??= {};
  meta.reportDurations[reportFile] = durationMs;
}

async function appendRunQualityStatus(
  paths: RunPaths,
  meta: AuditMeta,
  previousReports: Record<string, string>
): Promise<void> {
  const section = renderRunQualityStatus(meta);
  if (!section) {
    return;
  }
  const reportFile = "index.md";
  const markerStart = "<!-- repovista-run-quality:start -->";
  const markerEnd = "<!-- repovista-run-quality:end -->";
  const existing = previousReports[reportFile] ?? await safeReadReport(reportPath(paths.runDir, reportFile), "Executive Summary");
  const block = `${markerStart}
${section}
${markerEnd}`;
  const updated = existing.includes(markerStart) && existing.includes(markerEnd)
    ? existing.replace(new RegExp(`${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}`), block)
    : `${existing.trimEnd()}

${block}
`;
  await writeMarkdownReport(reportPath(paths.runDir, reportFile), updated);
  previousReports[reportFile] = updated;
}

function renderRunQualityStatus(meta: AuditMeta): string {
  const failedPhases = meta.phases.filter((phase) => phase.status === "failed");
  const repairedPhases = meta.phases.filter((phase) => phase.repairAttempts?.length);
  if (!failedPhases.length && !repairedPhases.length) {
    return "";
  }
  const lines = [
    "## RepoVista Run Quality Status",
    "",
    `- Overall exit code: ${meta.exitCode ?? "not determined"}`,
    `- Failed phases: ${failedPhases.length ? failedPhases.map((phase) => phase.title).join(", ") : "none"}`,
    `- Repair attempts: ${repairedPhases.reduce((sum, phase) => sum + (phase.repairAttempts?.length ?? 0), 0)}`
  ];
  for (const phase of failedPhases) {
    lines.push(`- ${phase.title}: ${phase.error ?? "failed"}`);
    for (const warning of phase.qualityWarnings ?? []) {
      lines.push(`  - ${warning}`);
    }
  }
  for (const phase of repairedPhases) {
    for (const attempt of phase.repairAttempts ?? []) {
      lines.push(`- ${phase.title} repair ${attempt.attempt}: ${attempt.status}${attempt.error ? ` (${attempt.error})` : ""}`);
      if (attempt.warnings.length) {
        lines.push(`  - Triggered by: ${attempt.warnings.join("; ")}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function completeRunTiming(meta: AuditMeta, runStartedAtMs: number): void {
  meta.completedAt = new Date().toISOString();
  meta.durationMs = Math.max(0, Date.now() - runStartedAtMs);
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AuditCancelledError(abortReason(signal));
  }
}

function isAuditCancelled(error: unknown, signal: AbortSignal | undefined): boolean {
  return error instanceof AuditCancelledError || Boolean(signal?.aborted);
}

function abortReason(signal: AbortSignal): string {
  const reason = signal.reason;
  if (reason instanceof Error && reason.message) {
    return reason.message;
  }
  if (typeof reason === "string" && reason.trim()) {
    return reason;
  }
  return "RepoVista audit was cancelled.";
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

async function loadReusableReportsFromCache(cache: AuditMeta["cache"] | undefined): Promise<Record<string, string>> {
  const reports: Record<string, string> = {};
  if (!cache?.enabled || !cache.phaseReuse?.length) {
    return reports;
  }
  const previousMetaByRun = new Map<string, Awaited<ReturnType<typeof readPreviousMeta>>>();
  const previousManifestByRun = new Map<string, Awaited<ReturnType<typeof readPreviousPromptManifest>>>();
  for (const reuse of cache.phaseReuse) {
    if (!reuse.hit || !reuse.previousRunDir) {
      continue;
    }
    try {
      if (!previousMetaByRun.has(reuse.previousRunDir)) {
        previousMetaByRun.set(reuse.previousRunDir, await readPreviousMeta(reuse.previousRunDir));
      }
      if (!previousManifestByRun.has(reuse.previousRunDir)) {
        previousManifestByRun.set(reuse.previousRunDir, await readPreviousPromptManifest(reuse.previousRunDir));
      }
      const content = await readReport(reportPath(reuse.previousRunDir, reuse.reportFile));
      const previousStatus = findPreviousPhaseStatus(previousMetaByRun.get(reuse.previousRunDir), reuse.phaseId);
      const manifestPhase = previousManifestByRun.get(reuse.previousRunDir)?.phases?.find((item) =>
        item.phaseId === reuse.phaseId && item.reportFile === reuse.reportFile
      );
      const quality = validateReportQuality(reuse.phaseId, content);
      if (
        previousStatus?.status === "success" &&
        previousStatus.qualityPassed !== false &&
        manifestPhase &&
        isReusablePhaseReport(reuse.phaseId, content) &&
        quality.passed
      ) {
        reports[reuse.reportFile] = content;
      }
    } catch {
      // Cache entries are advisory; unusable phase reports are recomputed.
    }
  }
  return reports;
}

function reusableShardReportsFromCache(cache: AuditMeta["cache"] | undefined): Record<string, Record<string, ReusableShardReport>> {
  const reports: Record<string, Record<string, ReusableShardReport>> = {};
  if (!cache?.enabled || !cache.shardReuse?.length) {
    return reports;
  }
  for (const reuse of cache.shardReuse) {
    if (!reuse.hit || !reuse.previousRunDir) {
      continue;
    }
    reports[reuse.phaseId] ??= {};
    reports[reuse.phaseId][reuse.shardId] = {
      previousRunDir: reuse.previousRunDir,
      reportFile: reuse.reportFile,
      previousRunId: reuse.previousRunId
    };
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
  meta: AuditMeta,
  riskReport: string | undefined,
  findings: StructuredFinding[],
  evidence: EvidencePack | undefined
): number {
  const hasCritical = findings.some((finding) => finding.severity === "critical") ||
    Boolean(!findings.length && riskReport && hasCriticalFindings(riskReport));
  if (options.ci && options.failOnCritical && hasCritical) {
    return 2;
  }
  const severityCounts = countFindingsBySeverity(findings);
  const gateViolations = [
    ...thresholdViolation("critical findings", severityCounts.critical ?? 0, options.maxCritical),
    ...thresholdViolation("high findings", severityCounts.high ?? 0, options.maxHigh),
    ...thresholdViolation("medium findings", severityCounts.medium ?? 0, options.maxMedium),
    ...qualityGateViolations(meta.phases, options.minQualityScore),
    ...(options.failOnWeakEvidence ? weakEvidenceGateViolations(findings) : []),
    ...(options.failOnDrift && meta.repositoryDrift?.detected ? meta.repositoryDrift.warnings : [])
  ];
  if (gateViolations.length) {
    meta.preflight.warnings.push(...gateViolations.map((warning) => `CI gate: ${warning}`));
    return 2;
  }
  if (meta.phases.some((phase) => phase.status === "failed")) {
    return 1;
  }
  if (options.ci && evidence && hasFailedChecks(evidence)) {
    return 1;
  }
  return 0;
}

function thresholdViolation(label: string, count: number, max: number | undefined): string[] {
  return typeof max === "number" && count > max ? [`${label} ${count} exceeds configured maximum ${max}.`] : [];
}

function qualityGateViolations(phases: PhaseReportStatus[], minimum: number | undefined): string[] {
  if (typeof minimum !== "number") {
    return [];
  }
  return phases
    .filter((phase) => typeof phase.qualityScore === "number" && phase.qualityScore < minimum)
    .map((phase) => `${phase.title} quality score ${phase.qualityScore}/100 is below configured minimum ${minimum}/100.`);
}

function weakEvidenceGateViolations(findings: StructuredFinding[]): string[] {
  const weak = findings.filter((finding) => {
    const refs = finding.evidenceDetails?.length
      ? finding.evidenceDetails
      : (finding.evidenceReferences ?? []).map((reference) => typeof reference === "string" ? { path: reference } : reference);
    return !refs.length ||
      refs.some((reference) => !reference.startLine || !reference.endLine) ||
      !refs.some((reference) => reference.quote) ||
      Boolean(finding.evidenceValidation && !finding.evidenceValidation.passed);
  });
  return weak.length ? [`${weak.length} finding(s) contain weak evidence.`] : [];
}

function countFindingsBySeverity(findings: StructuredFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    return counts;
  }, {});
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
    bugFindingsOnly: Boolean(options.bugFindingsOnly),
    deepReview: Boolean(options.deepReview),
    snapshot: Boolean(options.snapshot),
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

function buildPhaseCacheEntries(
  files: ProjectFileSummary[],
  options: AuditOptions,
  context: { reuseKey: string; promptManifestFingerprint: string; effectiveModel?: string }
): PhaseCacheEntry[] {
  return ANALYSIS_PHASES.map((phase) => ({
    phaseId: phase.id,
    reportFile: phase.reportFile,
    fingerprint: stableCacheFingerprint({
      cacheKind: "phase",
      phaseId: phase.id,
      files: phaseScopedFiles(phase.id, files).map(cacheFileForReuse),
      options: phaseCacheOptions(options, phase.id),
      reuseKey: context.reuseKey,
      promptManifestFingerprint: context.promptManifestFingerprint,
      effectiveModel: context.effectiveModel ?? null
    })
  }));
}

function buildFeatureCacheEntries(files: ProjectFileSummary[], features: Array<{ id: string; paths?: string[]; ownedFiles?: string[]; contextFiles?: string[]; tests?: string[] }>): FeatureCacheEntry[] {
  return features.map((feature) => {
    const paths = "paths" in feature ? [
      ...(feature.paths ?? []),
      ...(feature.ownedFiles ?? []),
      ...(feature.contextFiles ?? []),
      ...(feature.tests ?? [])
    ] : [];
    return {
      featureId: feature.id,
      fingerprint: stableCacheFingerprint({
        cacheKind: "feature",
        featureId: feature.id,
        paths: Array.from(new Set(paths)).sort(),
        files: filesForPathPrefixes(files, paths).map(cacheFileForReuse)
      })
    };
  });
}

function buildShardCacheEntries(files: ProjectFileSummary[], parallel: ParallelExecutionMeta | undefined): ShardCacheEntry[] {
  if (!parallel?.shards?.length) {
    return [];
  }
  return ANALYSIS_PHASES
    .filter((phase) => canParallelizePhase(phase))
    .flatMap((phase) => parallel.shards.map((shard) => ({
      phaseId: phase.id,
      shardId: shard.id,
      reportFile: `shards/${phase.id}/${shard.id}.md`,
      fingerprint: stableCacheFingerprint({
        cacheKind: "shard",
        phaseId: phase.id,
        shardId: shard.id,
        paths: shard.paths,
        files: filesForPathPrefixes(files, shard.paths).map(cacheFileForReuse)
      })
    })));
}

function phaseScopedFiles(phaseId: string, files: ProjectFileSummary[]): ProjectFileSummary[] {
  if (phaseId === "summary" || phaseId === "architecture" || phaseId === "feature-roadmap") {
    return files;
  }
  if (phaseId === "risk-and-bug") {
    return files.filter((file) => /(^|\/)(src|app|lib|server|api|routes|controllers|services|middleware|auth|security|config|scripts|test|tests|spec|__tests__)(\/|$)|\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|rb|php|cs|cpp|c|h|sql|yaml|yml|toml|json)$/i.test(file.relativePath));
  }
  if (phaseId === "code-quality") {
    return files.filter((file) => !/\.(md|markdown|png|jpg|jpeg|gif|webp|svg|ico|lock)$/i.test(file.relativePath));
  }
  return files;
}

function filesForPathPrefixes(files: ProjectFileSummary[], prefixes: string[]): ProjectFileSummary[] {
  const normalized = prefixes.map((prefix) => prefix.replace(/\/+$/g, "")).filter(Boolean);
  if (!normalized.length) {
    return files;
  }
  return files.filter((file) => normalized.some((prefix) =>
    file.relativePath === prefix ||
    file.relativePath.startsWith(`${prefix}/`) ||
    prefix.startsWith(`${file.relativePath}/`)
  ));
}

function cacheFileForReuse(file: ProjectFileSummary): Record<string, unknown> {
  return {
    path: file.relativePath,
    size: file.size,
    sha256: file.sha256 ?? null,
    mtimeMs: file.sha256 ? undefined : file.mtimeMs,
    language: file.language
  };
}

function phaseCacheOptions(options: AuditOptions, phaseId: string): Record<string, unknown> {
  return {
    phaseId,
    language: options.language,
    provider: options.provider ?? "codex",
    model: options.model ?? null,
    profile: options.profile ?? null,
    reasoning: options.reasoning ?? null,
    fastMode: Boolean(options.fastMode),
    reviewMode: options.reviewMode ?? "default",
    auditProfile: options.auditProfile ?? null,
    strictReports: Boolean(options.strictReports),
    repairReports: Boolean(options.repairReports),
    bugFindingsOnly: Boolean(options.bugFindingsOnly),
    deepReview: Boolean(options.deepReview),
    promptFile: options.promptFile ?? null,
    phases: options.phases
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
    bugFindingsOnly: Boolean(input.options.bugFindingsOnly),
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
