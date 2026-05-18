export type SandboxMode = "read-only" | "workspace-write";

export type CliAction = "audit" | "help" | "version";

export interface AuditOptions {
  command: "audit";
  outDir: string;
  model?: string;
  profile?: string;
  sandbox: SandboxMode;
  language: string;
  json: boolean;
  includes: string[];
  ignores: string[];
  ci: boolean;
  failOnCritical: boolean;
  progress: boolean;
  keepLogs: boolean;
}

export interface CliParseResult {
  action: CliAction;
  options: AuditOptions;
}

export interface RunPaths {
  outRoot: string;
  runDir: string;
  runId: string;
  logsDir?: string;
}

export interface PhaseReportStatus {
  id: string;
  title: string;
  reportFile: string;
  status: "pending" | "success" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
}

export interface AuditMeta {
  tool: {
    name: "RepoVista";
    version: string;
  };
  projectRoot: string;
  reportDir: string;
  runId: string;
  startedAt: string;
  completedAt?: string;
  options: {
    outDir: string;
    language: string;
    json: boolean;
    includes: string[];
    ignores: string[];
    ci: boolean;
    failOnCritical: boolean;
    progress: boolean;
    keepLogs: boolean;
  };
  codex: {
    model?: string;
    profile?: string;
    sandbox: SandboxMode;
  };
  preflight: {
    codexAvailable: boolean;
    projectRecognized: boolean;
    gitRepository: boolean;
    warnings: string[];
  };
  phases: PhaseReportStatus[];
  exitCode: number;
}

export interface CodexRunRequest {
  phaseId: string;
  phaseTitle: string;
  prompt: string;
  projectRoot: string;
  reportPath: string;
  logsDir?: string;
  model?: string;
  profile?: string;
  sandbox: SandboxMode;
  jsonEvents: boolean;
  keepLogs: boolean;
}

export interface CodexRunResult {
  phaseId: string;
  success: boolean;
  reportPath: string;
  durationMs: number;
  exitCode?: number | null;
  error?: string;
  stdoutLogPath?: string;
  stderrLogPath?: string;
}
