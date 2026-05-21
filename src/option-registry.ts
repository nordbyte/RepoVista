import type { AuditOptions } from "./types.js";

export type RegistryCliOptionKind = "value" | "boolean";
export type RegistrySettingType = "string" | "boolean" | "number" | "list" | "enum";

export interface OptionRegistryEntry {
  key?: keyof AuditOptions;
  defaultValue?: unknown;
  cli?: {
    name: string;
    kind: RegistryCliOptionKind;
    help: string;
  };
  setting?: {
    key: string;
    type: RegistrySettingType;
    help: string;
  };
  menu?: {
    id: string;
  };
}

export const OPTION_REGISTRY: readonly OptionRegistryEntry[] = [
  entry("provider", "codex", value("provider", "Report provider: codex, claude, gemini, opencode, aider, or a loaded plugin (default: codex)"), setting("provider", "enum", "Default report provider"), "provider"),
  entry("allowRepoProviderPlugin", undefined, flag("allow-repo-provider-plugin", "Allow execution of provider plugins declared in this repository")),
  entry("parallel", "auto", value("parallel", "Parallel provider-session budget for phases and shards: off, auto, or 1-5 (default: auto)"), setting("parallel", "enum", "Default shared parallel provider-session budget"), "parallel"),
  entry("refresh", false, flag("refresh", "Refresh cached project metadata for commands that support it")),
  entry("parallel", undefined, flag("no-parallel", "Disable saved parallel default")),
  entry("outDir", ".repovista", value("out", "Report output directory (default: .repovista)"), setting("outDir", "string", "Default report output directory"), "outDir"),
  entry("resumeDir", undefined, value("resume", "Resume or complete an existing RepoVista run directory")),
  entry("githubRepo", undefined, value("github-repo", "Audit a public GitHub repository by owner/repo or https://github.com/owner/repo")),
  entry("githubRef", undefined, value("github-ref", "Branch, tag, or full commit SHA to audit when --github-repo is used")),
  entry("since", undefined, value("since", "Focus the audit on files changed since the given Git ref")),
  entry("prMode", undefined, flag("pr", "PR mode; default diff base is origin/main unless --base is set")),
  entry("prMode", undefined, flag("no-pr", "Disable saved PR mode")),
  entry("baseRef", undefined, value("base", "Base ref for --pr or diff-focused audits")),
  entry("auditProfile", undefined, value("audit-profile", "Built-in audit profile: quick, security, pr-review, release-readiness, architecture"), setting("auditProfile", "enum", "Built-in audit profile"), "auditProfile"),
  entry("reviewMode", "default", value("review-mode", "Review mode: default, deslopify, security, or test-gaps"), setting("reviewMode", "enum", "Default review mode"), "reviewMode"),
  entry("promptFile", undefined, value("prompt-file", "Append extra read-only reviewer guidance from a file"), setting("promptFile", "string", "Default prompt guidance file"), "promptFile"),
  entry("workspace", undefined, value("workspace", "Limit the audit to a detected workspace by name or path"), setting("workspace", "string", "Default workspace name or path"), "workspace"),
  entry("allWorkspaces", undefined, flag("all-workspaces", "Record and include all detected workspaces"), setting("allWorkspaces", "boolean", "Include all detected workspaces"), "allWorkspaces"),
  entry("incremental", true, flag("incremental", "Record scan-cache metadata and detect unchanged project scans (default: on)"), setting("incremental", "boolean", "Use project scan cache metadata"), "incremental"),
  entry("model", undefined, value("model", "Override the provider model"), setting("model", "string", "Default provider model"), "model"),
  entry("profile", undefined, value("profile", "Use a provider configuration profile, currently Codex profile for codex"), setting("profile", "string", "Default provider profile"), "profile"),
  entry("reasoning", "xhigh", value("reasoning", "Override provider reasoning effort (default: xhigh)"), setting("reasoning", "string", "Default reasoning effort"), "reasoning"),
  entry("fastMode", false, flag("fast", "Use Codex fast service tier when supported"), setting("fastMode", "boolean", "Use fast provider tier where supported"), "fastMode"),
  entry("fastMode", undefined, flag("no-fast", "Disable Codex fast service tier")),
  entry("sandbox", "read-only", value("sandbox", "Provider sandbox: read-only or workspace-write (default: read-only)"), setting("sandbox", "enum", "Default provider sandbox mode"), "sandbox"),
  entry("language", "English", value("language", "Report language (default: English)"), setting("language", "string", "Default report language"), "language"),
  entry("publishLanguage", "English", value("publish-language", "GitHub issue/PR language for published findings (default: English)"), setting("publishLanguage", "string", "Default GitHub issue/PR language")),
  entry("json", false, flag("json", "Store metadata, provider logs/events, or emit command JSON where supported"), setting("json", "boolean", "Keep JSON provider events/log metadata"), "json"),
  entry("includes", [], value("include", "Additional include patterns for inventory/context"), setting("includes", "list", "Default include patterns"), "includes"),
  entry("ignores", [], value("ignore", "Additional ignore patterns"), setting("ignores", "list", "Default ignore patterns"), "ignores"),
  entry("phases", [], value("phase", "Run only selected phase(s); repeatable or comma-separated")),
  entry("runChecks", true, flag("run-checks", "Run detected or explicit local check commands before analysis (default: on)"), setting("runChecks", "boolean", "Run local checks before audit"), "runChecks"),
  entry("runChecks", undefined, flag("no-run-checks", "Disable saved run-checks default")),
  entry("checkCommands", [], value("check", "Add an explicit local check command for --run-checks"), setting("checkCommands", "list", "Explicit local check commands"), "checkCommands"),
  entry("checkTimeoutSeconds", 300, value("check-timeout", "Timeout per local check command in minutes (default: 5)"), setting("checkTimeoutSeconds", "number", "Local check timeout in seconds"), "checkTimeout"),
  entry("phaseTimeoutSeconds", 1800, value("timeout", "Timeout per provider phase in minutes (default: 30)"), setting("phaseTimeoutSeconds", "number", "Provider phase timeout in seconds"), "phaseTimeout"),
  entry("phaseTimeoutSeconds", undefined, value("phase-timeout", "Alias for --timeout")),
  entry("strictReports", true, flag("strict-reports", "Fail phases when report quality gates warn (default: on)"), setting("strictReports", "boolean", "Fail phases on report quality warnings"), "strictReports"),
  entry("strictReports", undefined, flag("no-strict-reports", "Disable saved strict report default")),
  entry("repairReports", true, flag("repair-reports", "Ask the provider to repair reports that miss quality gates (default: on)"), setting("repairReports", "boolean", "Repair reports that miss quality gates"), "repairReports"),
  entry("repairReports", undefined, flag("no-repair-reports", "Disable saved report repair default")),
  entry("repairAttempts", 2, value("repair-attempts", "Maximum repair attempts per phase, 1-3 (default: 2)"), setting("repairAttempts", "number", "Maximum report repair attempts")),
  entry("deepReview", false, flag("deep-review", "Run additional feature-sliced risk review passes and merge their findings"), setting("deepReview", "boolean", "Run feature-sliced deep review passes"), "deepReview"),
  entry("deepReview", undefined, flag("no-deep-review", "Disable saved feature-sliced deep review default")),
  entry("snapshot", false, flag("snapshot", "Run provider analysis in a detached Git worktree snapshot"), setting("snapshot", "boolean", "Analyze a detached Git snapshot"), "snapshot"),
  entry("failOnDrift", false, flag("fail-on-drift", "Exit with code 2 when repository drift is detected"), setting("failOnDrift", "boolean", "Fail when repository drift is detected"), "failOnDrift"),
  entry("failOnWeakEvidence", false, flag("fail-on-weak-evidence", "Exit with code 2 when findings contain weak evidence"), setting("failOnWeakEvidence", "boolean", "Fail when findings contain weak evidence"), "failOnWeakEvidence"),
  entry("minQualityScore", undefined, value("min-quality-score", "Minimum accepted phase quality score from 0-100"), setting("minQualityScore", "number", "Minimum phase quality score")),
  entry("maxCritical", undefined, value("max-critical", "Maximum critical findings allowed before exit 2"), setting("maxCritical", "number", "Maximum critical findings")),
  entry("maxHigh", undefined, value("max-high", "Maximum high findings allowed before exit 2"), setting("maxHigh", "number", "Maximum high findings")),
  entry("maxMedium", undefined, value("max-medium", "Maximum medium findings allowed before exit 2"), setting("maxMedium", "number", "Maximum medium findings")),
  entry("maxNewCritical", undefined, value("max-new-critical", "Maximum new critical findings allowed in compare before exit 2")),
  entry("maxNewHigh", undefined, value("max-new-high", "Maximum new high findings allowed in compare before exit 2")),
  entry("maxNewMedium", undefined, value("max-new-medium", "Maximum new medium findings allowed in compare before exit 2")),
  entry("workspaceMatrix", false, flag("workspace-matrix", "Run one audit per detected workspace and write an aggregate matrix summary")),
  entry("exportFormats", ["sarif", "html", "jsonl"], value("export", "Export findings: sarif, html, jsonl, github (default: sarif,html,jsonl)"), setting("exportFormats", "list", "Default finding export formats"), "exportFormats"),
  entry("compareFormat", undefined, value("format", "Output format for compare: markdown, json, html")),
  entry("compareFailOnRegression", undefined, flag("fail-on-regression", "Exit with code 2 when compare detects new critical/high findings")),
  entry("ci", false, flag("ci", "CI mode without progress output"), setting("ci", "boolean", "Use CI output defaults"), "ci"),
  entry("failOnCritical", false, flag("fail-on-critical", "Exit with code 2 in CI when critical findings are detected"), setting("failOnCritical", "boolean", "Fail CI on critical findings"), "failOnCritical"),
  entry("progress", true, flag("no-progress", "Disable the interactive progress TUI, post-audit report browser, and reduce progress output"), setting("progress", "boolean", "Show progress TUI and post-audit browser"), "progress"),
  entry("keepLogs", false, flag("keep-logs", "Store technical provider logs"), setting("keepLogs", "boolean", "Keep technical provider logs"), "keepLogs"),
  entry("findingId", undefined, value("finding", "Finding id for show, triage, revalidate, issue, baseline, or suppress")),
  entry("findingRunId", undefined, value("run", "Run id or run directory for run-specific findings")),
  entry("findingStatus", undefined, value("status", "Finding status: open, fixed, false-positive, wont-fix, uncertain")),
  entry("note", undefined, value("note", "Triage, baseline, or issue note stored in command history")),
  entry("issueLabels", [], value("label", "GitHub issue label; repeatable")),
  entry("issueAssignees", [], value("assignee", "GitHub issue assignee; repeatable")),
  entry("issueUpdateExisting", undefined, flag("update-existing", "Update an existing matching GitHub issue instead of creating a duplicate")),
  entry("issueSync", undefined, flag("sync-issues", "Create, update, and persist GitHub issue links for selected findings")),
  entry("issueReopen", undefined, flag("reopen-issues", "Reopen linked GitHub issues when findings reappear as open")),
  entry("publishTarget", undefined, value("as", "Publish selected findings as issue or pr")),
  entry("publishFork", undefined, flag("fork", "Force fork-based pull request publishing for GitHub source runs")),
  entry("ownerRules", [], value("owner-rule", "Finding owner rule as path-glob=owner; repeatable")),
  entry("labelRules", [], value("label-rule", "Finding label rule as path-glob=label; repeatable")),
  entry("slaDays", undefined, value("sla-days", "Default finding SLA in days from first seen or creation time")),
  entry("patchId", undefined, value("patch", "Patch attempt id for patches or open-pr")),
  entry("patchBranch", undefined, value("branch", "Branch name for open-pr")),
  entry("patchTitle", undefined, value("title", "Title for open-pr")),
  entry("allFindings", undefined, flag("all", "Include all finding statuses or revalidate all findings")),
  entry("providerRevalidate", false, flag("provider-revalidate", "Ask the configured provider to revalidate finding status")),
  entry("dryRun", false, flag("dry-run", "Preview commands or issue/workflow content without writing remotely")),
  entry("fixIsolateBranch", undefined, flag("isolate-branch", "Run repovista fix on a temporary branch")),
  entry("fixNoIsolate", undefined, flag("no-isolate", "Run repovista fix on the current branch instead of an isolated branch")),
  entry("fixPostRevalidate", undefined, flag("post-revalidate", "Revalidate the fixed finding after repovista fix")),
  entry("patchMaxFiles", undefined, value("max-files", "Maximum changed files allowed for repovista fix scope gate")),
  entry("ciTemplate", undefined, value("template", "CI template for ci init: pr-light, security, release-readiness, scheduled-audit")),
  entry("force", undefined, flag("force", "Overwrite generated files where supported")),
  entry(undefined, undefined, flag("version", "Show version")),
  entry(undefined, undefined, flag("help", "Show help"))
];

export function createDefaultAuditOptions(): AuditOptions {
  const defaults: Record<string, unknown> = {
    command: "audit"
  };
  for (const item of OPTION_REGISTRY) {
    if (!item.key || item.defaultValue === undefined || defaults[item.key as string] !== undefined) {
      continue;
    }
    defaults[item.key as string] = copyDefaultValue(item.defaultValue);
  }
  return defaults as unknown as AuditOptions;
}

export function cliOptionDefinitions(): Array<{ name: string; kind: RegistryCliOptionKind; help: string }> {
  return OPTION_REGISTRY
    .filter((item): item is OptionRegistryEntry & { cli: NonNullable<OptionRegistryEntry["cli"]> } => Boolean(item.cli))
    .map((item) => item.cli);
}

export function settingDefinitions(): Array<{ key: string; type: RegistrySettingType; help: string }> {
  return OPTION_REGISTRY
    .filter((item): item is OptionRegistryEntry & { setting: NonNullable<OptionRegistryEntry["setting"]> } => Boolean(item.setting))
    .map((item) => item.setting);
}

export function settingKeysFromRegistry(): Set<string> {
  return new Set(settingDefinitions().map((definition) => definition.key));
}

export function menuItemIdsFromRegistry(): Set<string> {
  return new Set(OPTION_REGISTRY.map((item) => item.menu?.id).filter((value): value is string => Boolean(value)));
}

function entry(
  key: keyof AuditOptions | undefined,
  defaultValue?: unknown,
  cli?: OptionRegistryEntry["cli"],
  settingDefinition?: OptionRegistryEntry["setting"],
  menuId?: string
): OptionRegistryEntry {
  return {
    key,
    defaultValue,
    cli,
    setting: settingDefinition,
    menu: menuId ? { id: menuId } : undefined
  };
}

function value(name: string, help: string): NonNullable<OptionRegistryEntry["cli"]> {
  return { name, kind: "value", help };
}

function flag(name: string, help: string): NonNullable<OptionRegistryEntry["cli"]> {
  return { name, kind: "boolean", help };
}

function setting(key: string, type: RegistrySettingType, help: string): NonNullable<OptionRegistryEntry["setting"]> {
  return { key, type, help };
}

function copyDefaultValue(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
}
