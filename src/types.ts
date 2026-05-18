export type SandboxMode = "read-only" | "workspace-write";

export type AiProviderId = "codex" | "claude";

export type CliAction = "audit" | "settings" | "help" | "version";

export interface AuditOptions {
  command: "audit";
  provider: AiProviderId;
  outDir: string;
  resumeDir?: string;
  model?: string;
  profile?: string;
  reasoning?: string;
  fastMode: boolean;
  sandbox: SandboxMode;
  language: string;
  json: boolean;
  includes: string[];
  ignores: string[];
  phases: string[];
  runChecks: boolean;
  checkCommands: string[];
  checkTimeoutSeconds: number;
  phaseTimeoutSeconds: number;
  strictReports: boolean;
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
  qualityPassed?: boolean;
  qualityWarnings?: string[];
}

export interface EvidenceCommandResult {
  command: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface EvidencePack {
  collectedAt: string;
  projectRoot: string;
  runtime: {
    node: string;
    npm: string;
    platform: string;
  };
  packageJson?: {
    name?: string;
    version?: string;
    private?: boolean;
  };
  git: {
    available: boolean;
    branch?: string;
    commit?: string;
    dirty?: boolean;
    remote?: string;
    statusShort?: string[];
    error?: string;
  };
  codex: {
    available: boolean;
    version?: string;
    error?: string;
  };
  aiProvider: {
    id: AiProviderId;
    displayName: string;
    executable: string;
    available: boolean;
    version?: string;
    error?: string;
  };
  checks: {
    enabled: boolean;
    timeoutSeconds: number;
    commands: string[];
    results: EvidenceCommandResult[];
  };
}

export interface StructuredFinding {
  id: string;
  source: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  category?: string;
  paths: string[];
  evidence?: string;
  recommendation?: string;
  confidence?: string;
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
    provider: AiProviderId;
    outDir: string;
    resumeDir?: string;
    language: string;
    json: boolean;
    includes: string[];
    ignores: string[];
    phases: string[];
    runChecks: boolean;
    checkCommands: string[];
    checkTimeoutSeconds: number;
    phaseTimeoutSeconds: number;
    strictReports: boolean;
    ci: boolean;
    failOnCritical: boolean;
    progress: boolean;
    keepLogs: boolean;
  };
  codex: {
    model: string;
    profile: string;
    reasoning: string;
    fastMode: boolean;
    sandbox: SandboxMode;
  };
  ai: {
    provider: AiProviderId;
    displayName: string;
    executable: string;
    model: string;
    profile: string;
    reasoning: string;
    fastMode: boolean;
    sandbox: SandboxMode;
  };
  preflight: {
    codexAvailable: boolean;
    providerAvailable: boolean;
    provider: {
      id: AiProviderId;
      displayName: string;
      executable: string;
      available: boolean;
    };
    projectRecognized: boolean;
    gitRepository: boolean;
    warnings: string[];
  };
  evidence?: EvidencePack;
  phases: PhaseReportStatus[];
  findings: StructuredFinding[];
  outputs?: {
    findingsJson?: string;
    summaryJson?: string;
  };
  exitCode: number;
}

export interface ProviderRunRequest {
  provider: AiProviderId;
  phaseId: string;
  phaseTitle: string;
  prompt: string;
  projectRoot: string;
  reportPath: string;
  logsDir?: string;
  model?: string;
  profile?: string;
  reasoning?: string;
  fastMode: boolean;
  sandbox: SandboxMode;
  jsonEvents: boolean;
  keepLogs: boolean;
  timeoutSeconds: number;
}

export interface ProviderRunResult {
  phaseId: string;
  success: boolean;
  reportPath: string;
  durationMs: number;
  exitCode?: number | null;
  error?: string;
  stdoutLogPath?: string;
  stderrLogPath?: string;
}

export type CodexRunRequest = Omit<ProviderRunRequest, "provider"> & {
  provider?: "codex";
};

export type CodexRunResult = ProviderRunResult;
