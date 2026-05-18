import path from "node:path";
import { PreflightError } from "./errors.js";
import { createProjectInventory } from "./inventory.js";
import { Logger } from "./logger.js";
import { ANALYSIS_PHASES, type PromptContext } from "./prompts.js";
import { runPreflight, type PreflightDependencies } from "./preflight.js";
import { createRunId } from "./run-id.js";
import { prepareRunDirectory, readReport, reportPath, writeMarkdownReport, writeMeta } from "./reports.js";
import type { AuditMeta, AuditOptions, CodexRunResult, PhaseReportStatus, RunPaths } from "./types.js";
import { runCodexPhase, type SpawnAdapter } from "./codex-runner.js";

export interface AuditDependencies extends PreflightDependencies {
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
  if (path.resolve(projectRoot, options.outDir) === projectRoot) {
    throw new PreflightError("The report directory must not be identical to the project root.");
  }
  const paths = await prepareRunDirectory(projectRoot, options.outDir, createRunId(now), createLogs);

  const meta = createInitialMeta(projectRoot, paths, options, version, now);
  const phaseStatuses = meta.phases;

  try {
    logger.step("Preflight checks");
    const preflight = await runPreflight(projectRoot, paths.runDir, options, dependencies);
    meta.preflight = preflight;
    for (const warning of preflight.warnings) {
      logger.warn(warning);
    }

    logger.step("Creating project inventory");
    const inventory = await createProjectInventory(projectRoot, {
      outDir: options.outDir,
      includes: options.includes,
      ignores: options.ignores,
      now
    });
    for (const warning of inventory.warnings) {
      logger.warn(warning);
    }

    const inventoryPath = reportPath(paths.runDir, "00-inventory.md");
    await writeMarkdownReport(inventoryPath, inventory.markdown);

    const previousReports: Record<string, string> = {
      "00-inventory.md": inventory.markdown
    };

    const runCodex = dependencies.runCodex ?? runCodexPhase;
    for (const phase of ANALYSIS_PHASES) {
      logger.step(`${phase.title}`);
      const status = phaseStatuses.find((item) => item.id === phase.id);
      if (status) {
        status.status = "pending";
      }

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
        sandbox: options.sandbox,
        jsonEvents: options.json,
        keepLogs: options.keepLogs
      }, dependencies.spawnAdapter);

      updatePhaseStatus(status, result);

      try {
        previousReports[phase.reportFile] = await readReport(phaseReportPath);
      } catch {
        previousReports[phase.reportFile] = `# ${phase.title}\n\nReport could not be read.`;
      }
    }

    meta.exitCode = determineExitCode(options, phaseStatuses, previousReports["03-risk-and-bug-report.md"]);
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
      language: options.language,
      json: options.json,
      includes: options.includes,
      ignores: options.ignores,
      ci: options.ci,
      failOnCritical: options.failOnCritical,
      progress: options.progress,
      keepLogs: options.keepLogs
    },
    codex: {
      model: options.model,
      profile: options.profile,
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
    exitCode: 0
  };
}

function updatePhaseStatus(status: PhaseReportStatus | undefined, result: CodexRunResult): void {
  if (!status) {
    return;
  }

  status.status = result.success ? "success" : "failed";
  status.durationMs = result.durationMs;
  if (result.error) {
    status.error = result.error;
  }
}

function determineExitCode(options: AuditOptions, phases: PhaseReportStatus[], riskReport: string | undefined): number {
  if (options.ci && options.failOnCritical && riskReport && hasCriticalFindings(riskReport)) {
    return 2;
  }
  return phases.some((phase) => phase.status === "failed") ? 1 : 0;
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
