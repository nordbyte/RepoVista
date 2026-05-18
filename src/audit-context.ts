import path from "node:path";
import { PreflightError } from "./errors.js";
import { collectDiffScope } from "./git-diff.js";
import { Logger } from "./logger.js";
import { ANALYSIS_PHASES } from "./prompts.js";
import { getReportProvider } from "./providers/index.js";
import type {
  AuditMeta,
  AuditOptions,
  DiffScope,
  PhaseReportStatus,
  RunPaths,
  SemanticFeature
} from "./types.js";

export function createInitialMeta(
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
      since: options.since,
      prMode: options.prMode,
      baseRef: options.baseRef,
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
      keepLogs: options.keepLogs,
      repairReports: Boolean(options.repairReports),
      repairAttempts: options.repairAttempts,
      exportFormats: options.exportFormats ?? []
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

export async function collectAuditDiffScope(
  projectRoot: string,
  ref: string,
  logger: Logger
): Promise<DiffScope> {
  try {
    const scope = await collectDiffScope(projectRoot, ref);
    logger.info(`Diff audit scope: ${scope.changedFiles.length} changed file(s) since ${scope.ref}.`);
    return scope;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PreflightError(`Could not collect --since diff scope: ${message}`);
  }
}

export function allowedEvidencePaths(features: SemanticFeature[]): Set<string> | undefined {
  const values = new Set<string>();
  for (const feature of features) {
    for (const item of [
      ...feature.paths,
      ...feature.ownedFiles,
      ...feature.contextFiles,
      ...feature.tests
    ]) {
      if (item) {
        values.add(item);
      }
    }
  }
  return values.size ? values : undefined;
}

export function reportFolderName(outDir: string): string {
  return path.basename(outDir);
}
