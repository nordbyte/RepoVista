import { stat } from "node:fs/promises";
import path from "node:path";
import { PreflightError } from "./errors.js";
import { collectEvidence, type EvidenceDependencies, hasFailedChecks } from "./evidence.js";
import { extractFindings, findingCountsBySeverity } from "./findings.js";
import { createProjectInventory } from "./inventory.js";
import { Logger } from "./logger.js";
import { ANALYSIS_PHASES, type PhaseDefinition, type PromptContext } from "./prompts.js";
import { validateReportQuality } from "./quality-gates.js";
import { runPreflight, type PreflightDependencies } from "./preflight.js";
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
  CodexRunResult,
  EvidencePack,
  PhaseReportStatus,
  RunPaths,
  StructuredFinding
} from "./types.js";
import { runCodexPhase, type SpawnAdapter } from "./codex-runner.js";

export interface AuditDependencies extends PreflightDependencies, EvidenceDependencies {
  cwd?: string;
  now?: Date;
  version?: string;
  runCodex?: typeof runCodexPhase;
  spawnAdapter?: SpawnAdapter;
}

export interface AuditResult {
  paths: RunPaths;
  meta: AuditMeta;
  exitCode: number;
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
      codex: {
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
    const runCodex = dependencies.runCodex ?? runCodexPhase;
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
      const result = await runCodex({
        phaseId: phase.id,
        phaseTitle: phase.title,
        prompt,
        projectRoot,
        reportPath: phaseReportPath,
        logsDir: paths.logsDir,
        model: options.model,
        profile: options.profile,
        reasoning: options.reasoning,
        fastMode: options.fastMode,
        sandbox: options.sandbox,
        jsonEvents: options.json,
        keepLogs: options.keepLogs,
        timeoutSeconds: options.phaseTimeoutSeconds ?? 1800
      }, dependencies.spawnAdapter);

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

async function createRunPaths(projectRoot: string, options: AuditOptions, now: Date, createLogs: boolean): Promise<RunPaths> {
  if (options.resumeDir) {
    try {
      return await useExistingRunDirectory(projectRoot, options.resumeDir, createLogs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PreflightError(`Could not resume RepoVista run: ${message}`);
    }
  }

  if (path.resolve(projectRoot, options.outDir) === projectRoot) {
    throw new PreflightError("The report directory must not be identical to the project root.");
  }
  return prepareRunDirectory(projectRoot, options.outDir, createRunId(now), createLogs);
}

function createInitialMeta(
  projectRoot: string,
  paths: RunPaths,
  options: AuditOptions,
  version: string,
  startedAt: Date
): AuditMeta {
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
    preflight: {
      codexAvailable: false,
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
  result: CodexRunResult,
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
  await writeJsonFile(findingsPath, findings);
  await writeJsonFile(summaryPath, {
    tool: meta.tool,
    runId: meta.runId,
    reportDir: meta.reportDir,
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    codex: meta.codex,
    evidence: {
      git: evidence.git,
      codex: evidence.codex,
      checks: {
        enabled: evidence.checks.enabled,
        commands: evidence.checks.commands,
        failed: hasFailedChecks(evidence)
      }
    },
    phases: meta.phases,
    findingCounts: findingCountsBySeverity(findings)
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
