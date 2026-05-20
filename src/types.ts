export type SandboxMode = "read-only" | "workspace-write";

export type AiProviderId = string;

export type ParallelMode = "off" | "auto" | number;
export type ReportExportFormat = "sarif" | "html" | "jsonl" | "github";
export type CompareFormat = "markdown" | "json" | "html";
export type AuditProfileId = "quick" | "security" | "pr-review" | "release-readiness" | "architecture";
export type ReviewMode = "default" | "deslopify" | "security" | "test-gaps";

export type CliAction =
  | "audit"
  | "init"
  | "plan"
  | "settings"
  | "settings-get"
  | "settings-set"
  | "settings-reset"
  | "findings"
  | "findings-ui"
  | "reports"
  | "compare"
  | "review"
  | "pr-comment"
  | "repair-run"
  | "doctor"
  | "providers"
  | "baseline"
  | "suppress"
  | "clean-locks"
  | "fix"
  | "patches"
  | "rollback"
  | "open-pr"
  | "ci-init"
  | "profiles"
  | "next"
  | "show"
  | "triage"
  | "revalidate"
  | "issue"
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
  runChecksExplicit?: boolean;
  checkCommands: string[];
  checkTimeoutSeconds: number;
  phaseTimeoutSeconds: number;
  strictReports: boolean;
  strictReportsExplicit?: boolean;
  repairReports: boolean;
  repairReportsExplicit?: boolean;
  repairAttempts: number;
  deepReview: boolean;
  deepReviewExplicit?: boolean;
  snapshot: boolean;
  failOnDrift?: boolean;
  failOnWeakEvidence?: boolean;
  minQualityScore?: number;
  maxCritical?: number;
  maxHigh?: number;
  maxMedium?: number;
  maxNewCritical?: number;
  maxNewHigh?: number;
  maxNewMedium?: number;
  reviewMode?: ReviewMode;
  promptFile?: string;
  exportFormats: ReportExportFormat[];
  exportFormatsExplicit?: boolean;
  exportFormatsCliExplicit?: boolean;
  ci: boolean;
  failOnCritical: boolean;
  progress: boolean;
  parallelExplicit?: boolean;
  keepLogs: boolean;
  auditProfile?: AuditProfileId;
  workspace?: string;
  allWorkspaces?: boolean;
  incremental?: boolean;
  compareOldRun?: string;
  compareNewRun?: string;
  reportRunDir?: string;
  compareFormat?: CompareFormat;
  compareFailOnRegression?: boolean;
  refresh?: boolean;
  since?: string;
  prMode?: boolean;
  baseRef?: string;
  findingId?: string;
  findingStatus?: FindingStatus;
  note?: string;
  allFindings?: boolean;
  findingRunId?: string;
  providerRevalidate?: boolean;
  dryRun?: boolean;
  force?: boolean;
  providerAction?: "list" | "test";
  baselineAction?: "list" | "add" | "remove" | "prune";
  issueLabels?: string[];
  issueAssignees?: string[];
  issueUpdateExisting?: boolean;
  patchId?: string;
  patchBranch?: string;
  patchTitle?: string;
  fixIsolateBranch?: boolean;
  fixNoIsolate?: boolean;
  fixPostRevalidate?: boolean;
  patchMaxFiles?: number;
  allowRepoProviderPlugin?: boolean;
  ciTemplate?: "pr-light" | "security" | "release-readiness" | "scheduled-audit";
  settingsKey?: string;
  settingsValue?: string;
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
  totalDurationMs?: number;
  error?: string;
  qualityPassed?: boolean;
  qualityWarnings?: string[];
  qualityScore?: number;
  shards?: PhaseShardStatus[];
  deepReviewShards?: PhaseShardStatus[];
  repairAttempts?: PhaseRepairAttempt[];
  providerRun?: ProviderRunDiagnostics;
  preservedPreviousReport?: boolean;
  retryError?: string;
  retryDurationMs?: number;
}

export interface PhaseRepairAttempt {
  attempt: number;
  phaseId: string;
  status: "success" | "failed";
  warnings: string[];
  durationMs: number;
  error?: string;
  providerRun?: ProviderRunDiagnostics;
}

export interface PhaseShardStatus {
  id: string;
  title: string;
  reportFile: string;
  status: "pending" | "success" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
  attempts?: number;
  providerRun?: ProviderRunDiagnostics;
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
  evidenceReferences?: Array<string | FindingEvidenceReference>;
  evidenceDetails?: FindingEvidenceReference[];
  evidenceValidation?: FindingEvidenceValidation;
  recommendation?: string;
  problemRationale?: string;
  reproduction?: string;
  suggestedRegressionTest?: string;
  minimumFixScope?: string;
  estimatedEffort?: string;
  confidence?: string;
  parentId?: string;
  parentTitle?: string;
  childFindings?: StructuredFinding[];
  findingType?: "theme" | "atomic";
  featureId?: string;
  firstSeenRunId?: string;
  lastSeenRunId?: string;
  createdAt?: string;
  updatedAt?: string;
  history?: FindingHistoryEntry[];
  schemaVersion?: number;
}

export interface StructuredRoadmapProposal {
  title: string;
  description: string;
  evidence: string[];
  benefit: string;
  effort: string;
  risk: string;
  affected: string[];
  steps: string[];
  priority: string;
  confidence: string;
}

export interface StructuredPhaseReport {
  schemaVersion: 1;
  phaseId: string;
  source: string;
  executiveSummary?: string;
  keyPoints: string[];
  evidenceReferences: string[];
  recommendations: string[];
  proposals?: StructuredRoadmapProposal[];
  findings?: StructuredFinding[];
  warnings: string[];
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
  source?: "prompt-context" | "evidence-pack" | "provider-discovered";
  promptIncluded?: boolean;
  warning?: string;
}

export interface FindingHistoryEntry {
  runId?: string;
  kind: "audit" | "triage" | "revalidate" | "provider-revalidate";
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
  durationMs?: number;
  reportDurations?: Record<string, number>;
  options: {
    provider: AiProviderId;
    parallel: ParallelMode;
    outDir: string;
    resumeDir?: string;
    since?: string;
    prMode?: boolean;
    baseRef?: string;
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
    repairReports: boolean;
    repairAttempts?: number;
    deepReview?: boolean;
    snapshot?: boolean;
    failOnDrift?: boolean;
    failOnWeakEvidence?: boolean;
    minQualityScore?: number;
    maxCritical?: number;
    maxHigh?: number;
    maxMedium?: number;
    maxNewCritical?: number;
    maxNewHigh?: number;
    maxNewMedium?: number;
    reviewMode?: ReviewMode;
    promptFile?: string;
    exportFormats: ReportExportFormat[];
    ci: boolean;
    failOnCritical: boolean;
    progress: boolean;
    keepLogs: boolean;
    auditProfile?: AuditProfileId;
    workspace?: string;
    allWorkspaces?: boolean;
    incremental?: boolean;
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
  workspace?: WorkspaceDetectionResult;
  cache?: AuditCacheMeta;
  evidence?: EvidencePack;
  phases: PhaseReportStatus[];
  findings: StructuredFinding[];
  suppressedFindings?: StructuredFinding[];
  findingCounts?: Record<string, number>;
  suppressedFindingCounts?: Record<string, number>;
  outputs?: {
    findingsJson?: string;
    summaryJson?: string;
    reportJson?: string;
    promptManifestJson?: string;
    findingStateDir?: string;
    featureStateDir?: string;
    featuresJson?: string;
    findingsSarif?: string;
    findingsJsonl?: string;
    htmlReport?: string;
    githubAnnotationsJson?: string;
    structuredReportsJson?: string;
  };
  analytics?: RunAnalytics;
  repositoryDrift?: RepositoryDriftState;
  snapshot?: AuditSnapshotMeta;
  exitCode: number;
}

export interface AuditSnapshotMeta {
  enabled: boolean;
  originalRoot: string;
  analysisRoot: string;
  commit?: string;
  branch?: string;
  dirty: boolean;
  statusShort: string[];
  patchPath?: string;
  untrackedPath?: string;
  createdAt: string;
  cleanupStatus?: "pending" | "removed" | "failed";
  warnings: string[];
}

export interface RepositoryGitSnapshot {
  available: boolean;
  capturedAt: string;
  branch?: string;
  commit?: string;
  dirty?: boolean;
  statusShort?: string[];
  error?: string;
}

export interface RepositoryDriftState {
  initial?: RepositoryGitSnapshot;
  current?: RepositoryGitSnapshot;
  detected: boolean;
  detectedAt?: string;
  warnings: string[];
}

export interface RunAnalytics {
  provider: AiProviderId;
  model?: string;
  reasoning?: string;
  phaseCount: number;
  totalDurationMs: number;
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  estimatedTotalTokens: number;
  estimatedCostUsd?: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualTotalTokens?: number;
  actualCostUsd?: number;
  telemetryKnown?: boolean;
  pricingKnown: boolean;
  phases: Array<{
    id: string;
    status: string;
    durationMs: number;
    totalDurationMs?: number;
    promptTokens: number;
    actualInputTokens?: number;
    actualOutputTokens?: number;
    actualTotalTokens?: number;
    actualCostUsd?: number;
    telemetryKnown?: boolean;
    reportFile: string;
  }>;
}

export interface ProjectFileSummary {
  relativePath: string;
  extension: string;
  size: number;
  language: string;
  mtimeMs?: number;
  hashAlgorithm?: "sha256";
  sha256?: string;
  scopeReason?: string;
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  packageManager: string;
  packageJsonPath?: string;
  patterns: string[];
  scripts?: Record<string, string>;
  dependencies?: string[];
  validationCommands?: string[];
}

export interface WorkspaceDetectionResult {
  detected: boolean;
  selected?: string;
  allWorkspaces: boolean;
  workspaces: WorkspaceInfo[];
  warnings: string[];
}

export interface AuditCacheMeta {
  enabled: boolean;
  cachePath: string;
  scanFingerprint: string;
  reuseKey?: string;
  promptManifestFingerprint?: string;
  providerVersion?: string;
  promptContextVersion?: number;
  phaseSchemaVersion?: number;
  qualityGateVersion?: number;
  hit: boolean;
  previousRunDir?: string;
  previousRunId?: string;
  mismatchReasons?: string[];
  updatedAt: string;
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
  featureIds?: string[];
  validationCommands?: string[];
  workspace?: string;
}

export interface SemanticFeature {
  id: string;
  title: string;
  kind: string;
  paths: string[];
  ownedFiles: string[];
  contextFiles: string[];
  tests: string[];
  entrypoints?: string[];
  validationCommands?: string[];
  tags: string[];
  trustBoundaries: string[];
  source: "project-map" | "diff" | "mapper";
  confidence: "high" | "medium" | "low";
}

export type FeatureStatus = "pending" | "claimed" | "reviewed" | "needs-fix" | "fixed" | "skipped" | "error" | "revalidated";

export interface FeatureLock {
  runId: string;
  command: string;
  pid: number;
  createdAt: string;
}

export interface FeatureHistoryEntry {
  runId?: string;
  kind: "map" | "claim" | "review" | "audit" | "fix" | "revalidate" | "error";
  status?: FeatureStatus;
  note?: string;
  findingIds?: string[];
  createdAt: string;
}

export interface FeatureRecord extends SemanticFeature {
  schemaVersion: 1;
  featureId: string;
  status: FeatureStatus;
  signature: string;
  findingIds: string[];
  patchAttemptIds: string[];
  lock: FeatureLock | null;
  analysisHistory: FeatureHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface DiffScope {
  ref: string;
  changedFiles: string[];
  fileStatuses?: DiffFileStatus[];
}

export interface DiffFileStatus {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";
  previousPath?: string;
}

export interface PromptManifestFile {
  path: string;
  role: "inventory" | "previous-report" | "project-file" | "feature-map" | "prompt-file";
  bytes: number;
  includedBytes: number;
  truncated: boolean;
  readable: boolean;
  hashAlgorithm?: "sha256";
  sha256?: string;
  inclusionReason?: string;
  tokenBudgetEstimate?: number;
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
  workspaces?: WorkspaceInfo[];
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
  outputSchema?: Record<string, unknown>;
  outputSchemaKind?: "risk-report" | "phase-report" | "fix-plan" | "revalidation";
  outputSchemaPath?: string;
  structuredOutputPath?: string;
  promptFilePath?: string;
  onProgress?: (event: ProviderRunProgressEvent) => void;
  abortSignal?: AbortSignal;
}

export type ProviderRunProgressEvent =
  | {
      kind: "spawned";
      phaseId: string;
      at: string;
      pid?: number;
    }
  | {
      kind: "output";
      phaseId: string;
      at: string;
      stream: "stdout" | "stderr";
      bytes: number;
    }
  | {
      kind: "closed";
      phaseId: string;
      at: string;
      exitCode?: number | null;
      signal?: string | null;
    };

export interface ProviderRunResult {
  phaseId: string;
  success: boolean;
  reportPath: string;
  durationMs: number;
  exitCode?: number | null;
  error?: string;
  stdoutLogPath?: string;
  stderrLogPath?: string;
  structuredOutputPath?: string;
  diagnostics?: ProviderRunDiagnostics;
  repairAttempts?: PhaseRepairAttempt[];
  preservedPreviousReport?: boolean;
  retryError?: string;
  retryDurationMs?: number;
}

export interface ProviderRunDiagnostics {
  provider: AiProviderId;
  executable: string;
  args: string[];
  phaseId: string;
  pid?: number;
  processGroup?: boolean;
  startedAt: string;
  endedAt?: string;
  timeoutSeconds: number;
  timedOut: boolean;
  interrupted: boolean;
  exitCode?: number | null;
  signal?: string | null;
  stdoutLogPath?: string;
  stderrLogPath?: string;
  structuredOutputPath?: string;
  telemetry?: ProviderUsageTelemetry;
  termination?: {
    reason: "timeout" | "interrupt";
    sigintSent?: boolean;
    sigintAt?: string;
    sigtermSent: boolean;
    sigtermAt?: string;
    sigkillSent: boolean;
    sigkillAt?: string;
    forcedSettle: boolean;
    errors: string[];
  };
}

export interface ProviderUsageTelemetry {
  source: "stdout" | "stderr" | "combined";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface ProviderCapabilities {
  outputSchema: boolean;
  readOnlySandbox: boolean;
  workspaceWrite: boolean;
  jsonEvents: boolean;
  promptFile: boolean;
}

export type PatchAttemptStatus = "planned" | "applied" | "failed" | "validated" | "pr-opened";

export interface PatchAttempt {
  schemaVersion: 1;
  patchAttemptId: string;
  findingIds: string[];
  featureIds: string[];
  status: PatchAttemptStatus;
  plan: string;
  filesChanged: string[];
  preDiff?: string;
  postDiff?: string;
  scopeGate?: {
    passed: boolean;
    maxFiles: number;
    allowedPaths: string[];
    violations: string[];
  };
  revalidation?: {
    status: "not-run" | "passed" | "failed";
    output?: string;
  };
  commandsRun: EvidenceCommandResult[];
  provider?: {
    id: AiProviderId;
    model?: string;
    reasoning?: string;
    reportPath?: string;
  };
  git: {
    baseSha?: string;
    originalBranch?: string;
    branchName?: string;
    commitSha?: string;
    prUrl?: string;
    diffPath?: string;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type CodexRunRequest = Omit<ProviderRunRequest, "provider"> & {
  provider?: "codex";
};

export type CodexRunResult = ProviderRunResult;
