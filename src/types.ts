export type SandboxMode = "read-only" | "workspace-write";

export type AiProviderId = "codex" | "claude";

export type ParallelMode = "off" | "auto" | number;

export type CliAction =
  | "audit"
  | "init"
  | "plan"
  | "settings"
  | "compare"
  | "next"
  | "show"
  | "triage"
  | "revalidate"
  | "help"
  | "version";

export type FindingStatus = "open" | "fixed" | "false-positive" | "wont-fix" | "uncertain";

export interface AuditOptions {
  command: "audit";
  provider: AiProviderId;
  parallel: ParallelMode;
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
  compareOldRun?: string;
  compareNewRun?: string;
  since?: string;
  findingId?: string;
  findingStatus?: FindingStatus;
  note?: string;
  allFindings?: boolean;
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
  shards?: PhaseShardStatus[];
}

export interface PhaseShardStatus {
  id: string;
  title: string;
  reportFile: string;
  status: "pending" | "success" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
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
  status?: FindingStatus;
  triage?: string;
  signature?: string;
  paths: string[];
  evidence?: string;
  evidenceReferences?: string[];
  evidenceDetails?: FindingEvidenceReference[];
  evidenceValidation?: FindingEvidenceValidation;
  recommendation?: string;
  problemRationale?: string;
  estimatedEffort?: string;
  confidence?: string;
  firstSeenRunId?: string;
  lastSeenRunId?: string;
  createdAt?: string;
  updatedAt?: string;
  history?: FindingHistoryEntry[];
  schemaVersion?: number;
}

export interface FindingEvidenceReference {
  path: string;
  startLine?: number;
  endLine?: number;
  quote?: string;
  symbol?: string;
}

export interface FindingEvidenceValidation {
  checkedAt: string;
  passed: boolean;
  warnings: string[];
  references: FindingEvidenceValidationReference[];
}

export interface FindingEvidenceValidationReference {
  path: string;
  exists: boolean;
  insideRoot: boolean;
  lineRangeValid?: boolean;
  quoteMatches?: boolean;
  warning?: string;
}

export interface FindingHistoryEntry {
  runId?: string;
  kind: "audit" | "triage" | "revalidate";
  status?: FindingStatus;
  note?: string;
  reasoning?: string;
  commands: string[];
  createdAt: string;
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
    parallel: ParallelMode;
    outDir: string;
    resumeDir?: string;
    since?: string;
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
  parallel?: ParallelExecutionMeta;
  evidence?: EvidencePack;
  phases: PhaseReportStatus[];
  findings: StructuredFinding[];
  findingCounts?: Record<string, number>;
  outputs?: {
    findingsJson?: string;
    summaryJson?: string;
    promptManifestJson?: string;
    findingStateDir?: string;
    featuresJson?: string;
  };
  exitCode: number;
}

export interface ProjectFileSummary {
  relativePath: string;
  extension: string;
  size: number;
  language: string;
}

export interface ProjectArea {
  id: string;
  title: string;
  description: string;
  paths: string[];
  primaryLanguages: string[];
  fileCount: number;
  bytes: number;
}

export interface WorkShard {
  id: string;
  title: string;
  description: string;
  paths: string[];
  primaryLanguages: string[];
  estimatedFiles: number;
  estimatedBytes: number;
  focus: string;
}

export interface SemanticFeature {
  id: string;
  title: string;
  kind: string;
  paths: string[];
  ownedFiles: string[];
  contextFiles: string[];
  tests: string[];
  tags: string[];
  trustBoundaries: string[];
  source: "project-map" | "diff";
  confidence: "high" | "medium" | "low";
}

export interface DiffScope {
  ref: string;
  changedFiles: string[];
}

export interface PromptManifestFile {
  path: string;
  role: "inventory" | "previous-report" | "project-file" | "feature-map";
  bytes: number;
  includedBytes: number;
  truncated: boolean;
  readable: boolean;
  skippedReason?: string;
}

export interface PromptManifestPhase {
  phaseId: string;
  reportFile: string;
  promptBytes: number;
  approximateTokens: number;
  includedFiles: PromptManifestFile[];
  omittedFiles: PromptManifestFile[];
}

export interface PromptManifest {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  since?: DiffScope;
  features: SemanticFeature[];
  phases: PromptManifestPhase[];
}

export interface ProjectMap {
  version: 1;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  outDir: string;
  fileCount: number;
  totalBytes: number;
  languages: Record<string, number>;
  frameworks: string[];
  packageManagers: string[];
  areas: ProjectArea[];
  features: SemanticFeature[];
  recommendedParallelism: number;
  recommendedShards: WorkShard[];
  since?: DiffScope;
  warnings: string[];
}

export interface ParallelExecutionMeta {
  mode: ParallelMode;
  projectMapPath?: string;
  initialized: boolean;
  recommendedParallelism: number;
  effectiveParallelism: number;
  shards: WorkShard[];
  warnings: string[];
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
