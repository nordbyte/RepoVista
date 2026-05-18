import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PreflightError } from "./errors.js";
import { collectEvidence, type EvidenceDependencies, hasFailedChecks } from "./evidence.js";
import { extractFindings, findingCountsBySeverity } from "./findings.js";
import { createProjectInventory } from "./inventory.js";
import { Logger } from "./logger.js";
import { ANALYSIS_PHASES, type PhaseDefinition, type PromptContext } from "./prompts.js";
import { validateReportQuality } from "./quality-gates.js";
import { runPreflight, type PreflightDependencies } from "./preflight.js";
import { createParallelExecutionMeta, loadProjectMap } from "./project-map.js";
import { getReportProvider } from "./providers/index.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { createRunId } from "./run-id.js";
import {
  prepareRunDirectory,
  readReport,
  reportPath,
  useExistingRunDirectory,
  writeJsonFile,
  writeMarkdownReport,
  writeMeta
} from "./reports.js";
import type {
  AuditMeta,
  AuditOptions,
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
  runProvider?: typeof runProviderPhase;
  runCodex?: typeof runProviderPhase;
  spawnAdapter?: SpawnAdapter;
}

export interface AuditResult {
  paths: RunPaths;
  meta: AuditMeta;
  exitCode: number;
}

type RunPhaseFunction = typeof runProviderPhase;

interface SinglePhaseInput {
  phase: PhaseDefinition;
  prompt: string;
  projectRoot: string;
  phaseReportPath: string;
  paths: RunPaths;
  options: AuditOptions;
  runPhase: RunPhaseFunction;
  spawnAdapter?: SpawnAdapter;
}

interface ParallelPhaseInput {
  phase: PhaseDefinition;
  prompt: string;
  context: PromptContext;
  projectRoot: string;
  paths: RunPaths;
  options: AuditOptions;
  parallel: ParallelExecutionMeta;
  runPhase: RunPhaseFunction;
  spawnAdapter?: SpawnAdapter;
  resume: boolean;
  status: PhaseReportStatus;
}

export async function runAudit(options: AuditOptions, dependencies: AuditDependencies = {}): Promise<AuditResult> {
  const projectRoot = dependencies.cwd ?? process.cwd();
  const now = dependencies.now ?? new Date();
  const version = dependencies.version ?? "0.0.0";
  const logger = new Logger(options.progress);
  const createLogs = options.keepLogs || options.json;
  const paths = await createRunPaths(projectRoot, options, now, createLogs);

  const meta = createInitialMeta(projectRoot, paths, options, version, now);
  const previousReports: Record<string, string> = {};

  try {
    if (options.resumeDir) {
      await loadExistingReports(paths, previousReports, meta.phases);
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

    logger.step("Creating project inventory");
    const inventory = await createProjectInventory(projectRoot, {
      outDir: options.outDir,
      includes: options.includes,
      ignores: options.ignores,
      ai: {
        provider: options.provider ?? "codex",
        displayName: getReportProvider(options.provider ?? "codex").displayName,
        executable: getReportProvider(options.provider ?? "codex").executable,
        model: options.model,
        profile: options.profile,
        reasoning: options.reasoning,
        fastMode: options.fastMode,
        sandbox: options.sandbox
      },
      evidence,
      now
    });
    for (const warning of inventory.warnings) {
      logger.warn(warning);
    }

    const inventoryPath = reportPath(paths.runDir, "00-inventory.md");
    await writeMarkdownReport(inventoryPath, inventory.markdown);
    previousReports["00-inventory.md"] = inventory.markdown;

    const selectedPhases = expandSelectedPhases(options.phases ?? []);
    const runPhase = dependencies.runProvider ?? dependencies.runCodex ?? runProviderPhase;
    const parallel = await resolveParallelMeta(projectRoot, options, logger);
    meta.parallel = parallel;
    let detailPhaseRan = false;

    for (const phase of ANALYSIS_PHASES) {
      const status = phaseStatus(meta.phases, phase);
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
        reportFolderName: path.basename(options.outDir),
        inventoryMarkdown: inventory.markdown,
        previousReports
      };
      const prompt = phase.buildPrompt(context);
      const result = parallel && parallel.effectiveParallelism > 1 && canParallelizePhase(phase)
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
            status
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

      await updatePhaseStatus(status, phase, result, options.strictReports);
      previousReports[phase.reportFile] = await safeReadReport(phaseReportPath, phase.title);
      if (phase.id !== "summary" && result.success) {
        detailPhaseRan = true;
      }
    }

    const findings = extractFindings(previousReports["03-risk-and-bug-report.md"] ?? "");
    meta.findings = findings;
    meta.exitCode = determineExitCode(options, meta.phases, previousReports["03-risk-and-bug-report.md"], findings, evidence);
    meta.completedAt = new Date().toISOString();
    await writeStructuredOutputs(paths, meta, findings, evidence);
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

async function runSinglePhase(input: SinglePhaseInput): Promise<ProviderRunResult> {
  return input.runPhase({
    provider: input.options.provider ?? "codex",
    phaseId: input.phase.id,
    phaseTitle: input.phase.title,
    prompt: input.prompt,
    projectRoot: input.projectRoot,
    reportPath: input.phaseReportPath,
    logsDir: input.paths.logsDir,
    model: input.options.model,
    profile: input.options.profile,
    reasoning: input.options.reasoning,
    fastMode: input.options.fastMode,
    sandbox: input.options.sandbox,
    jsonEvents: input.options.json,
    keepLogs: input.options.keepLogs,
    timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800
  }, input.spawnAdapter);
}

async function runParallelPhase(input: ParallelPhaseInput): Promise<ProviderRunResult> {
  const startedAt = Date.now();
  const shardDirectory = path.join(input.paths.runDir, "shards", input.phase.id);
  await mkdir(shardDirectory, { recursive: true });
  input.status.shards = input.parallel.shards.map((shard) => ({
    id: shard.id,
    title: shard.title,
    reportFile: path.relative(input.paths.runDir, shardReportPath(shardDirectory, shard.id)).split(path.sep).join("/"),
    status: "pending"
  }));

  const shardResults = await runWithConcurrency(input.parallel.shards, input.parallel.effectiveParallelism, async (shard) => {
    const report = shardReportPath(shardDirectory, shard.id);
    const shardStatus = input.status.shards?.find((item) => item.id === shard.id);
    if (input.resume && await pathExists(report)) {
      if (shardStatus) {
        shardStatus.status = "success";
        shardStatus.durationMs = 0;
      }
      return {
        shard,
        result: {
          phaseId: `${input.phase.id}-${shard.id}`,
          success: true,
          reportPath: report,
          durationMs: 0,
          exitCode: 0
        } satisfies ProviderRunResult
      };
    }

    const result = await input.runPhase({
      provider: input.options.provider ?? "codex",
      phaseId: `${input.phase.id}-${shard.id}`,
      phaseTitle: `${input.phase.title} (${shard.title})`,
      prompt: buildShardPrompt(input.prompt, shard),
      projectRoot: input.projectRoot,
      reportPath: report,
      logsDir: input.paths.logsDir,
      model: input.options.model,
      profile: input.options.profile,
      reasoning: input.options.reasoning,
      fastMode: input.options.fastMode,
      sandbox: input.options.sandbox,
      jsonEvents: input.options.json,
      keepLogs: input.options.keepLogs,
      timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800
    }, input.spawnAdapter);
    if (shardStatus) {
      shardStatus.status = result.success ? "success" : "failed";
      shardStatus.durationMs = result.durationMs;
      shardStatus.error = result.error;
    }
    return { shard, result };
  });

  const failed = shardResults.filter((item) => !item.result.success);
  const finalReportPath = reportPath(input.paths.runDir, input.phase.reportFile);
  if (failed.length) {
    await writeFile(finalReportPath, renderFailedShardReport(input.phase, failed), "utf8");
    return {
      phaseId: input.phase.id,
      success: false,
      reportPath: finalReportPath,
      durationMs: Date.now() - startedAt,
      exitCode: 1,
      error: `${failed.length} shard(s) failed.`
    };
  }

  const shardReports: Record<string, string> = {};
  for (const { shard, result } of shardResults) {
    shardReports[shard.id] = await safeReadReport(result.reportPath, shard.title);
  }

  const synthesisPrompt = buildSynthesisPrompt(input.phase, input.context, input.prompt, shardReports);
  return input.runPhase({
    provider: input.options.provider ?? "codex",
    phaseId: `${input.phase.id}-synthesis`,
    phaseTitle: `${input.phase.title} Synthesis`,
    prompt: synthesisPrompt,
    projectRoot: input.projectRoot,
    reportPath: finalReportPath,
    logsDir: input.paths.logsDir,
    model: input.options.model,
    profile: input.options.profile,
    reasoning: input.options.reasoning,
    fastMode: input.options.fastMode,
    sandbox: input.options.sandbox,
    jsonEvents: input.options.json,
    keepLogs: input.options.keepLogs,
    timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800
  }, input.spawnAdapter);
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

function canParallelizePhase(phase: PhaseDefinition): boolean {
  return phase.id !== "summary";
}

function buildShardPrompt(basePrompt: string, shard: ParallelExecutionMeta["shards"][number]): string {
  return `${basePrompt}

Shard assignment:
- You are one parallel RepoVista worker for this phase.
- Focus on this shard only: ${shard.title}.
- Paths in scope: ${shard.paths.length ? shard.paths.map((item) => `\`${item}\``).join(", ") : "the whole project"}.
- Primary languages/signals: ${shard.primaryLanguages.join(", ") || "not detected"}.
- Focus notes: ${shard.focus}
- Mention cross-shard questions when you see them, but do not attempt to fully cover paths outside your assignment.
- Return a shard-level Markdown report with concrete evidence for this assignment.
`;
}

function buildSynthesisPrompt(
  phase: PhaseDefinition,
  context: PromptContext,
  basePrompt: string,
  shardReports: Record<string, string>
): string {
  const reports = Object.entries(shardReports)
    .map(([id, content]) => `## Shard ${id}\n\n${content}`)
    .join("\n\n");
  return `${basePrompt}

Additional task: synthesize the final ${phase.title} from the parallel shard reports below.

Rules:
- Produce the final report requested by the original task, not a meta-summary of the workers.
- Resolve duplicates across shards.
- Call out cross-shard risks or architecture patterns when supported by the shard reports.
- Keep concrete file/path evidence.
- Write the final report in ${context.language}.
- Return only the final Markdown report.

Parallel shard reports:

${reports}
`;
}

function renderFailedShardReport(
  phase: PhaseDefinition,
  failed: Array<{ shard: ParallelExecutionMeta["shards"][number]; result: ProviderRunResult }>
): string {
  const rows = failed.map(({ shard, result }) => `- ${shard.id} (${shard.title}): ${result.error ?? "failed"}`);
  return `# ${phase.title}

## Status

Failed.

## Failed Parallel Shards

${rows.join("\n")}
`;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }));
  return results;
}

function shardReportPath(shardDirectory: string, shardId: string): string {
  return path.join(shardDirectory, `${shardId}.md`);
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

function createInitialMeta(
  projectRoot: string,
  paths: RunPaths,
  options: AuditOptions,
  version: string,
  startedAt: Date
): AuditMeta {
  const provider = getReportProvider(options.provider ?? "codex");
  const providerDefaults = `${provider.displayName} configured default`;
  return {
    tool: {
      name: "RepoVista",
      version
    },
    projectRoot,
    reportDir: paths.runDir,
    runId: paths.runId,
    startedAt: startedAt.toISOString(),
    options: {
      provider: options.provider ?? "codex",
      parallel: options.parallel ?? "off",
      outDir: options.outDir,
      resumeDir: options.resumeDir,
      language: options.language,
      json: options.json,
      includes: options.includes,
      ignores: options.ignores,
      phases: options.phases ?? [],
      runChecks: Boolean(options.runChecks),
      checkCommands: options.checkCommands ?? [],
      checkTimeoutSeconds: options.checkTimeoutSeconds ?? 300,
      phaseTimeoutSeconds: options.phaseTimeoutSeconds ?? 1800,
      strictReports: Boolean(options.strictReports),
      ci: options.ci,
      failOnCritical: options.failOnCritical,
      progress: options.progress,
      keepLogs: options.keepLogs
    },
    codex: {
      model: options.model ?? "Codex configured default",
      profile: options.profile ?? "none",
      reasoning: options.reasoning ?? "model default",
      fastMode: options.fastMode,
      sandbox: options.sandbox
    },
    ai: {
      provider: provider.id,
      displayName: provider.displayName,
      executable: provider.executable,
      model: options.model ?? providerDefaults,
      profile: options.profile ?? "none",
      reasoning: options.reasoning ?? "model default",
      fastMode: options.fastMode,
      sandbox: options.sandbox
    },
    preflight: {
      codexAvailable: false,
      providerAvailable: false,
      provider: {
        id: provider.id,
        displayName: provider.displayName,
        executable: provider.executable,
        available: false
      },
      projectRecognized: false,
      gitRepository: false,
      warnings: []
    },
    phases: ANALYSIS_PHASES.map<PhaseReportStatus>((phase) => ({
      id: phase.id,
      title: phase.title,
      reportFile: phase.reportFile,
      status: "pending"
    })),
    findings: [],
    exitCode: 0
  };
}

async function loadExistingReports(
  paths: RunPaths,
  previousReports: Record<string, string>,
  statuses: PhaseReportStatus[]
): Promise<void> {
  for (const phase of ANALYSIS_PHASES) {
    const filePath = reportPath(paths.runDir, phase.reportFile);
    try {
      const content = await readReport(filePath);
      previousReports[phase.reportFile] = content;
      const status = phaseStatus(statuses, phase);
      status.status = "success";
      applyReportQuality(status, phase.id, content, false);
    } catch {
      // Missing reports are normal for an interrupted run.
    }
  }
}

function expandSelectedPhases(phases: string[]): Set<string> | undefined {
  if (!phases.length || phases.includes("all")) {
    return undefined;
  }
  return new Set(phases);
}

async function shouldRunPhase(
  phase: PhaseDefinition,
  status: PhaseReportStatus,
  paths: RunPaths,
  options: AuditOptions,
  selectedPhases: Set<string> | undefined,
  detailPhaseRan: boolean
): Promise<boolean> {
  if (selectedPhases) {
    return selectedPhases.has(phase.id) || selectedPhases.has(phase.reportFile);
  }

  if (!options.resumeDir) {
    return true;
  }

  const existingSuccess = status.status === "success" && await pathExists(reportPath(paths.runDir, phase.reportFile));
  if (phase.id === "summary") {
    return detailPhaseRan || !existingSuccess;
  }
  return !existingSuccess;
}

async function markSkippedOrPreserved(
  status: PhaseReportStatus,
  phase: PhaseDefinition,
  paths: RunPaths,
  previousReports: Record<string, string>
): Promise<void> {
  const filePath = reportPath(paths.runDir, phase.reportFile);
  try {
    const content = previousReports[phase.reportFile] ?? await readReport(filePath);
    previousReports[phase.reportFile] = content;
    status.status = status.status === "success" ? "success" : "skipped";
    applyReportQuality(status, phase.id, content, false);
  } catch {
    status.status = "skipped";
  }
}

function phaseStatus(statuses: PhaseReportStatus[], phase: PhaseDefinition): PhaseReportStatus {
  const status = statuses.find((item) => item.id === phase.id);
  if (status) {
    return status;
  }
  const created: PhaseReportStatus = {
    id: phase.id,
    title: phase.title,
    reportFile: phase.reportFile,
    status: "pending"
  };
  statuses.push(created);
  return created;
}

async function updatePhaseStatus(
  status: PhaseReportStatus,
  phase: PhaseDefinition,
  result: ProviderRunResult,
  strictReports: boolean
): Promise<void> {
  status.status = result.success ? "success" : "failed";
  status.durationMs = result.durationMs;
  if (result.error) {
    status.error = result.error;
  }

  if (!result.success) {
    return;
  }

  const content = await safeReadReport(result.reportPath, phase.title);
  applyReportQuality(status, phase.id, content, strictReports);
}

function applyReportQuality(status: PhaseReportStatus, phaseId: string, content: string, strictReports: boolean): void {
  const quality = validateReportQuality(phaseId, content);
  status.qualityPassed = quality.passed;
  status.qualityWarnings = quality.warnings;
  if (!quality.passed && strictReports) {
    status.status = "failed";
    status.error = `Report quality gate failed: ${quality.warnings.join(" ")}`;
  }
}

async function safeReadReport(filePath: string, title: string): Promise<string> {
  try {
    return await readReport(filePath);
  } catch {
    return `# ${title}\n\nReport could not be read.`;
  }
}

async function writeStructuredOutputs(
  paths: RunPaths,
  meta: AuditMeta,
  findings: StructuredFinding[],
  evidence: EvidencePack
): Promise<void> {
  const findingsPath = reportPath(paths.runDir, "findings.json");
  const summaryPath = reportPath(paths.runDir, "summary.json");
  const findingCounts = findingCountsBySeverity(findings);
  meta.findingCounts = findingCounts;
  await writeJsonFile(findingsPath, findings);
  await writeJsonFile(summaryPath, {
    tool: meta.tool,
    runId: meta.runId,
    reportDir: meta.reportDir,
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    ai: meta.ai,
    codex: meta.codex,
    parallel: meta.parallel,
    evidence: {
      git: evidence.git,
      aiProvider: evidence.aiProvider,
      codex: evidence.codex,
      checks: {
        enabled: evidence.checks.enabled,
        commands: evidence.checks.commands,
        failed: hasFailedChecks(evidence)
      }
    },
    phases: meta.phases,
    findingCounts
  });
  meta.outputs = {
    findingsJson: findingsPath,
    summaryJson: summaryPath
  };
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
