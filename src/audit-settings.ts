import type { AuditSettingsSummary } from "./logger.js";
import type { ReportProvider } from "./providers/types.js";
import type { AuditOptions } from "./types.js";

export interface EffectiveAuditSettings {
  providerId: string;
  providerDisplayName: string;
  providerExecutable: string;
  model: string;
  modelArgument?: string;
  reasoning: string;
  fastMode: boolean;
  providerProfile: string;
  sandbox: string;
  auditProfile: string;
  reviewMode: string;
  phases: string;
  parallel: string;
  workspaceMatrix: boolean;
  scope: string;
  runChecks: string;
  strictReports: boolean;
  repairReports: string;
  deepReview: boolean;
  snapshot: boolean;
  failOnDrift: boolean;
  failOnWeakEvidence: boolean;
  minQualityScore?: number;
  incremental: boolean;
  exportFormats: string;
  outDir: string;
  jsonEvents: boolean;
  keepLogs: boolean;
  phaseTimeout: string;
}

const FALLBACK_PROVIDER_MODELS: Record<string, string> = {
  codex: "gpt-5.5",
  claude: "sonnet",
  gemini: "gemini-2.5-pro",
  opencode: "anthropic/claude-sonnet-4-5",
  aider: "sonnet"
};

export function createEffectiveAuditSettings(
  options: AuditOptions,
  provider: ReportProvider,
  resolvedModel?: string
): EffectiveAuditSettings {
  const modelArgument = firstText(options.model, resolvedModel, FALLBACK_PROVIDER_MODELS[provider.id]);
  return {
    providerId: provider.id,
    providerDisplayName: provider.displayName,
    providerExecutable: provider.executable,
    model: modelArgument ?? "not supplied",
    modelArgument,
    reasoning: firstText(options.reasoning, "xhigh") ?? "xhigh",
    fastMode: Boolean(options.fastMode),
    providerProfile: firstText(options.profile, "none") ?? "none",
    sandbox: firstText(options.sandbox, "read-only") ?? "read-only",
    auditProfile: auditProfileLabel(options.auditProfile),
    reviewMode: reviewModeLabel(options.reviewMode),
    phases: phasesLabel(options.phases),
    parallel: String(options.parallel ?? "auto"),
    workspaceMatrix: Boolean(options.workspaceMatrix),
    scope: scopeLabel(options),
    runChecks: runChecksLabel(options),
    strictReports: Boolean(options.strictReports),
    repairReports: repairReportsLabel(options),
    deepReview: Boolean(options.deepReview),
    snapshot: Boolean(options.snapshot),
    failOnDrift: Boolean(options.failOnDrift),
    failOnWeakEvidence: Boolean(options.failOnWeakEvidence),
    minQualityScore: options.minQualityScore,
    incremental: Boolean(options.incremental),
    exportFormats: options.exportFormats?.length ? options.exportFormats.join(", ") : "none",
    outDir: firstText(options.outDir, ".repovista") ?? ".repovista",
    jsonEvents: Boolean(options.json),
    keepLogs: Boolean(options.keepLogs),
    phaseTimeout: formatSeconds(options.phaseTimeoutSeconds ?? 1800)
  };
}

export function createAuditSettingsSummary(settings: EffectiveAuditSettings): AuditSettingsSummary {
  return {
    title: "Applied audit settings",
    lines: [
      `Provider: ${settings.providerDisplayName} (${settings.providerId}) | executable: ${settings.providerExecutable}`,
      `Model: ${settings.model} | reasoning: ${settings.reasoning} | fast mode: ${onOff(settings.fastMode)} | profile: ${settings.providerProfile} | sandbox: ${settings.sandbox}`,
      `Report: audit profile: ${settings.auditProfile} | review: ${settings.reviewMode} | phases: ${settings.phases} | parallel: ${settings.parallel} | workspace matrix: ${onOff(settings.workspaceMatrix)}`,
      `Scope: ${settings.scope}`,
      `Quality: checks: ${settings.runChecks} | strict gates: ${onOff(settings.strictReports)} | repair: ${settings.repairReports} | weak evidence gate: ${onOff(settings.failOnWeakEvidence)} | min quality: ${settings.minQualityScore ?? "off"}`,
      `Execution: snapshot: ${onOff(settings.snapshot)} | drift gate: ${onOff(settings.failOnDrift)} | deep review: ${onOff(settings.deepReview)} | incremental: ${onOff(settings.incremental)}`,
      `Output: ${settings.outDir} | exports: ${settings.exportFormats} | JSON events: ${onOff(settings.jsonEvents)} | logs: ${onOff(settings.keepLogs)} | phase timeout: ${settings.phaseTimeout}`
    ]
  };
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function auditProfileLabel(value: AuditOptions["auditProfile"]): string {
  switch (value) {
    case "quick":
      return "quick";
    case "security":
      return "security";
    case "pr-review":
      return "PR review";
    case "release-readiness":
      return "release readiness";
    case "architecture":
      return "architecture";
    case undefined:
      return "full audit";
  }
}

function reviewModeLabel(value: AuditOptions["reviewMode"]): string {
  switch (value) {
    case "deslopify":
      return "simplification and maintainability";
    case "security":
      return "security and abuse cases";
    case "test-gaps":
      return "missing tests and regressions";
    case "default":
    case undefined:
      return "general risk and quality";
  }
}

function phasesLabel(values: string[] | undefined): string {
  if (!values?.length || values.includes("all")) {
    return "all phases";
  }
  return values.join(", ");
}

function scopeLabel(options: AuditOptions): string {
  const workspace = options.allWorkspaces
    ? "all workspaces"
    : options.workspace
      ? `workspace ${options.workspace}`
      : "repository";
  const diff = options.since ? `changed since ${options.since}` : "full tree";
  const includes = options.includes?.length ? `${options.includes.length} include pattern(s)` : "no extra include patterns";
  const ignores = options.ignores?.length ? `${options.ignores.length} ignore pattern(s)` : "no extra ignore patterns";
  return `${workspace} | ${diff} | ${includes} | ${ignores}`;
}

function runChecksLabel(options: AuditOptions): string {
  if (!options.runChecks) {
    return "off";
  }
  return options.checkCommands?.length ? `on (${options.checkCommands.length} command(s))` : "on (auto)";
}

function repairReportsLabel(options: AuditOptions): string {
  if (!options.repairReports) {
    return "off";
  }
  const attempts = Math.max(1, options.repairAttempts ?? 1);
  return `on (${attempts} ${attempts === 1 ? "attempt" : "attempts"})`;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "off";
  }
  const rounded = Math.round(seconds);
  if (rounded % 60 === 0) {
    return `${rounded / 60}m`;
  }
  if (rounded < 60) {
    return `${rounded}s`;
  }
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function onOff(value: boolean): string {
  return value ? "on" : "off";
}
