import { CliUsageError } from "./errors.js";
import { BOOLEAN_OPTION_NAMES, renderCliHelp, VALUE_OPTION_NAMES } from "./cli-schema.js";
import { isReportProviderId, REPORT_PROVIDER_IDS } from "./providers/index.js";
import type { AiProviderId, AuditOptions, AuditProfileId, CliParseResult, CompareFormat, FindingStatus, ParallelMode, ReportExportFormat, ReviewMode, SandboxMode } from "./types.js";

export const DEFAULT_OPTIONS: AuditOptions = {
  command: "audit",
  provider: "codex",
  parallel: "off",
  outDir: ".repovista",
  sandbox: "read-only",
  language: "English",
  fastMode: false,
  json: false,
  includes: [],
  ignores: [],
  phases: [],
  runChecks: false,
  checkCommands: [],
  checkTimeoutSeconds: 300,
  phaseTimeoutSeconds: 1800,
  strictReports: false,
  repairReports: false,
  repairAttempts: 1,
  deepReview: false,
  reviewMode: "default",
  exportFormats: [],
  ci: false,
  failOnCritical: false,
  progress: true,
  keepLogs: false,
  providerRevalidate: false,
  dryRun: false,
  refresh: false,
  issueLabels: [],
  issueAssignees: []
};

const PHASE_IDS = new Set([
  "architecture",
  "code-quality",
  "risk-and-bug",
  "feature-roadmap",
  "summary"
]);

export function parseCliArgs(argv: string[], defaults: AuditOptions = DEFAULT_OPTIONS): CliParseResult {
  const options: AuditOptions = {
    ...defaults,
    includes: [...defaults.includes],
    ignores: [...defaults.ignores],
    phases: [...defaults.phases],
    checkCommands: [...defaults.checkCommands],
    exportFormats: [...defaults.exportFormats],
    issueLabels: [...(defaults.issueLabels ?? [])],
    issueAssignees: [...(defaults.issueAssignees ?? [])]
  };
  const positionals: string[] = [];
  let wantsHelp = false;
  let wantsVersion = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new CliUsageError(`Unknown short option: ${arg}`);
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    const name = equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;
    const inlineValue = equalsIndex >= 0 ? withoutPrefix.slice(equalsIndex + 1) : undefined;

    if (VALUE_OPTION_NAMES.has(name)) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError(`Option --${name} requires a value.`);
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      applyValueOption(options, name, value);
      continue;
    }

    if (!BOOLEAN_OPTION_NAMES.has(name)) {
      throw new CliUsageError(`Unknown option: --${name}`);
    }

    if (inlineValue !== undefined) {
      throw new CliUsageError(`Option --${name} does not take a value.`);
    }

    switch (name) {
      case "json":
        options.json = true;
        break;
      case "ci":
        options.ci = true;
        options.progress = false;
        break;
      case "fail-on-regression":
        options.compareFailOnRegression = true;
        break;
      case "fail-on-critical":
        options.failOnCritical = true;
        break;
      case "fast":
        options.fastMode = true;
        break;
      case "no-fast":
        options.fastMode = false;
        break;
      case "run-checks":
        options.runChecks = true;
        options.runChecksExplicit = true;
        break;
      case "no-run-checks":
        options.runChecks = false;
        options.runChecksExplicit = true;
        break;
      case "strict-reports":
        options.strictReports = true;
        options.strictReportsExplicit = true;
        break;
      case "no-strict-reports":
        options.strictReports = false;
        options.strictReportsExplicit = true;
        break;
      case "repair-reports":
        options.repairReports = true;
        options.repairReportsExplicit = true;
        break;
      case "no-repair-reports":
        options.repairReports = false;
        options.repairReportsExplicit = true;
        break;
      case "deep-review":
        options.deepReview = true;
        options.deepReviewExplicit = true;
        break;
      case "no-deep-review":
        options.deepReview = false;
        options.deepReviewExplicit = true;
        break;
      case "no-progress":
        options.progress = false;
        break;
      case "no-parallel":
        options.parallel = "off";
        options.parallelExplicit = true;
        break;
      case "refresh":
        options.refresh = true;
        break;
      case "keep-logs":
        options.keepLogs = true;
        break;
      case "all-workspaces":
        options.allWorkspaces = true;
        break;
      case "incremental":
        options.incremental = true;
        break;
      case "all":
        options.allFindings = true;
        break;
      case "provider-revalidate":
        options.providerRevalidate = true;
        break;
      case "allow-repo-provider-plugin":
        options.allowRepoProviderPlugin = true;
        break;
      case "isolate-branch":
        options.fixIsolateBranch = true;
        break;
      case "post-revalidate":
        options.fixPostRevalidate = true;
        break;
      case "dry-run":
        options.dryRun = true;
        break;
      case "force":
        options.force = true;
        break;
      case "update-existing":
        options.issueUpdateExisting = true;
        break;
      case "pr":
        options.prMode = true;
        options.since = options.since ?? options.baseRef ?? "origin/main";
        break;
      case "no-pr":
        options.prMode = false;
        break;
      case "version":
        wantsVersion = true;
        break;
      case "help":
        wantsHelp = true;
        break;
    }
  }

  const command = positionals[0] ?? "audit";
  const maxPositionals = maxPositionalsFor(positionals);
  if (positionals.length > maxPositionals) {
    throw new CliUsageError(`Too many positional arguments: ${positionals.join(" ")}`);
  }

  if (command === "help") {
    wantsHelp = true;
  } else if (command === "version") {
    wantsVersion = true;
  } else if (!isCommand(command)) {
    throw new CliUsageError(`Unknown command: ${command}`);
  }

  if (wantsVersion) {
    return { action: "version", options };
  }

  if (wantsHelp) {
    return { action: "help", options };
  }

  if (command === "compare") {
    if (positionals.length !== 3) {
      throw new CliUsageError("Command compare requires two run directories: repovista compare <old> <new>.");
    }
    options.compareOldRun = requireNonEmpty("old", positionals[1]);
    options.compareNewRun = requireNonEmpty("new", positionals[2]);
    if (options.json) {
      options.compareFormat = "json";
    }
    return { action: "compare", options };
  }

  if (command === "review" || command === "pr-comment") {
    if (positionals.length !== 2) {
      throw new CliUsageError(`Command ${command} requires one run directory.`);
    }
    options.reportRunDir = requireNonEmpty("run", positionals[1]);
    return { action: command, options };
  }

  if (command === "doctor") {
    if (positionals.length > 1) {
      throw new CliUsageError("Command doctor does not take positional arguments.");
    }
    return { action: "doctor", options };
  }

  if (command === "profiles") {
    if (positionals.length > 1) {
      throw new CliUsageError("Command profiles does not take positional arguments.");
    }
    return { action: "profiles", options };
  }

  if (command === "providers") {
    const subcommand = positionals[1] ?? "list";
    if (subcommand === "list") {
      if (positionals.length > 2) {
        throw new CliUsageError("Command providers list does not take positional arguments.");
      }
      options.providerAction = "list";
      return { action: "providers", options };
    }
    if (subcommand === "test") {
      if (positionals.length !== 3) {
        throw new CliUsageError("Command providers test requires a provider id.");
      }
      options.providerAction = "test";
      options.provider = validateProvider(positionals[2]);
      return { action: "providers", options };
    }
    throw new CliUsageError("Command providers supports list or test.");
  }

  if (command === "ci") {
    if (positionals[1] !== "init" || positionals.length > 2) {
      throw new CliUsageError("Command ci supports only: repovista ci init.");
    }
    return { action: "ci-init", options };
  }

  if (command === "baseline") {
    const subcommand = positionals[1] ?? "list";
    if (subcommand === "list" || subcommand === "prune") {
      if (positionals.length > 2) {
        throw new CliUsageError(`Command baseline ${subcommand} does not take a finding id.`);
      }
      options.baselineAction = subcommand;
      return { action: "baseline", options };
    }
    if (subcommand === "add" || subcommand === "remove") {
      if (positionals.length !== 3) {
        throw new CliUsageError(`Command baseline ${subcommand} requires a finding id.`);
      }
      options.baselineAction = subcommand;
      options.findingId = requireNonEmpty("finding", positionals[2]);
      return { action: "baseline", options };
    }
    throw new CliUsageError("Command baseline supports list, add, remove, and prune.");
  }

  if (command === "suppress") {
    if (positionals.length !== 2) {
      throw new CliUsageError("Command suppress requires a finding id.");
    }
    options.baselineAction = "add";
    options.findingId = requireNonEmpty("finding", positionals[1]);
    return { action: "suppress", options };
  }

  if (command === "clean-locks") {
    if (positionals.length > 1) {
      throw new CliUsageError("Command clean-locks does not take positional arguments.");
    }
    return { action: "clean-locks", options };
  }

  if (command === "settings") {
    const subcommand = positionals[1];
    if (!subcommand) {
      return { action: "settings", options };
    }
    if (subcommand === "get") {
      if (positionals.length > 3) {
        throw new CliUsageError("Command settings get accepts at most one key.");
      }
      options.settingsKey = positionals[2];
      return { action: "settings-get", options };
    }
    if (subcommand === "set") {
      if (positionals.length !== 4) {
        throw new CliUsageError("Command settings set requires a key and value.");
      }
      options.settingsKey = requireNonEmpty("setting", positionals[2]);
      options.settingsValue = positionals[3];
      return { action: "settings-set", options };
    }
    if (subcommand === "reset") {
      if (positionals.length > 3) {
        throw new CliUsageError("Command settings reset accepts at most one key.");
      }
      options.settingsKey = positionals[2];
      return { action: "settings-reset", options };
    }
    throw new CliUsageError("Command settings supports get, set, reset, or no subcommand for the interactive menu.");
  }

  if (command === "next") {
    if (positionals.length > 1) {
      throw new CliUsageError("Command next does not take positional arguments.");
    }
    return { action: "next", options };
  }

  if (command === "findings") {
    if (positionals.length > 1) {
      throw new CliUsageError("Command findings does not take positional arguments.");
    }
    return { action: "findings", options };
  }

  if (command === "findings-ui") {
    if (positionals.length > 1) {
      throw new CliUsageError("Command findings-ui does not take positional arguments.");
    }
    return { action: "findings-ui", options };
  }

  if (command === "show" || command === "triage" || command === "revalidate") {
    if (positionals.length > 2) {
      throw new CliUsageError(`Command ${command} accepts at most one finding id.`);
    }
    if (positionals[1]) {
      options.findingId = requireNonEmpty("finding", positionals[1]);
    }
    return { action: command, options };
  }

  if (command === "issue") {
    if (positionals.length > 2) {
      throw new CliUsageError("Command issue accepts at most one finding id.");
    }
    if (positionals[1]) {
      options.findingId = requireNonEmpty("finding", positionals[1]);
    }
    return { action: "issue", options };
  }

  if (command === "fix") {
    if (positionals.length > 2) {
      throw new CliUsageError("Command fix accepts at most one finding id.");
    }
    if (positionals[1]) {
      options.findingId = requireNonEmpty("finding", positionals[1]);
    }
    return { action: "fix", options };
  }

  if (command === "patches") {
    if (positionals.length > 2) {
      throw new CliUsageError("Command patches accepts at most one patch id.");
    }
    if (positionals[1]) {
      options.patchId = requireNonEmpty("patch", positionals[1]);
    }
    return { action: "patches", options };
  }

  if (command === "open-pr") {
    if (positionals.length > 2) {
      throw new CliUsageError("Command open-pr accepts at most one patch id.");
    }
    if (positionals[1]) {
      options.patchId = requireNonEmpty("patch", positionals[1]);
    }
    return { action: "open-pr", options };
  }

  if (positionals.length > 1) {
    throw new CliUsageError(`Too many positional arguments: ${positionals.join(" ")}`);
  }

  if (command === "init") {
    return { action: "init", options };
  }

  if (command === "plan") {
    return { action: "plan", options };
  }

  return { action: "audit", options };
}

function applyValueOption(options: AuditOptions, name: string, value: string): void {
  switch (name) {
    case "provider":
      options.provider = validateProvider(value);
      break;
    case "parallel":
      options.parallel = parseParallelMode(value);
      options.parallelExplicit = true;
      break;
    case "out":
      options.outDir = requireNonEmpty(name, value);
      break;
    case "resume":
      options.resumeDir = requireNonEmpty(name, value);
      break;
    case "model":
      options.model = requireNonEmpty(name, value);
      break;
    case "profile":
      options.profile = requireNonEmpty(name, value);
      break;
    case "reasoning":
      options.reasoning = requireNonEmpty(name, value);
      break;
    case "audit-profile":
      options.auditProfile = validateAuditProfile(value);
      break;
    case "review-mode":
      options.reviewMode = validateReviewMode(value);
      break;
    case "prompt-file":
      options.promptFile = requireNonEmpty(name, value);
      break;
    case "workspace":
      options.workspace = requireNonEmpty(name, value);
      break;
    case "sandbox":
      options.sandbox = validateSandbox(value);
      break;
    case "language":
      options.language = requireNonEmpty(name, value);
      break;
    case "include":
      options.includes.push(...splitPatterns(value));
      break;
    case "ignore":
      options.ignores.push(...splitPatterns(value));
      break;
    case "phase":
      options.phases.push(...splitPatterns(value).map(validatePhase));
      options.phases = Array.from(new Set(options.phases));
      break;
    case "check":
      options.checkCommands.push(requireNonEmpty(name, value));
      break;
    case "check-timeout":
      options.checkTimeoutSeconds = parsePositiveMinutes(name, value);
      break;
    case "phase-timeout":
    case "timeout":
      options.phaseTimeoutSeconds = parsePositiveMinutes(name, value);
      break;
    case "export":
      options.exportFormats.push(...splitPatterns(value).map(validateExportFormat));
      options.exportFormats = Array.from(new Set(options.exportFormats));
      break;
    case "format":
      options.compareFormat = validateCompareFormat(value);
      break;
    case "repair-attempts":
      options.repairAttempts = parsePositiveInteger(name, value, 3);
      break;
    case "max-files":
      options.patchMaxFiles = parsePositiveInteger(name, value, 100);
      break;
    case "template":
      options.ciTemplate = validateCiTemplate(value);
      break;
    case "since":
      options.since = requireNonEmpty(name, value);
      break;
    case "base":
      options.baseRef = requireNonEmpty(name, value);
      if (options.prMode || !options.since) {
        options.since = options.baseRef;
      }
      break;
    case "finding":
      options.findingId = requireNonEmpty(name, value);
      break;
    case "status":
      options.findingStatus = validateFindingStatus(value);
      break;
    case "note":
      options.note = requireNonEmpty(name, value);
      break;
    case "label":
      options.issueLabels = [...(options.issueLabels ?? []), requireNonEmpty(name, value)];
      break;
    case "assignee":
      options.issueAssignees = [...(options.issueAssignees ?? []), requireNonEmpty(name, value)];
      break;
    case "patch":
      options.patchId = requireNonEmpty(name, value);
      break;
    case "branch":
      options.patchBranch = requireNonEmpty(name, value);
      break;
    case "title":
      options.patchTitle = requireNonEmpty(name, value);
      break;
  }
}

function isCommand(value: string): boolean {
  return value === "audit" ||
    value === "init" ||
    value === "plan" ||
    value === "review" ||
    value === "pr-comment" ||
    value === "doctor" ||
    value === "providers" ||
    value === "profiles" ||
    value === "ci" ||
    value === "baseline" ||
    value === "suppress" ||
    value === "clean-locks" ||
    value === "settings" ||
    value === "findings" ||
    value === "findings-ui" ||
    value === "compare" ||
    value === "next" ||
    value === "show" ||
    value === "triage" ||
    value === "revalidate" ||
    value === "fix" ||
    value === "patches" ||
    value === "open-pr" ||
    value === "issue";
}

function maxPositionalsFor(positionals: string[]): number {
  const command = positionals[0] ?? "audit";
  if (command === "settings" && positionals[1] === "set") {
    return 4;
  }
  if (command === "compare") {
    return 3;
  }
  if (command === "review" || command === "pr-comment") {
    return 2;
  }
  if (command === "providers" && positionals[1] === "test") {
    return 3;
  }
  if (command === "baseline" && (positionals[1] === "add" || positionals[1] === "remove")) {
    return 3;
  }
  if (command === "fix" || command === "patches" || command === "open-pr") {
    return 2;
  }
  if (command === "ci") {
    return 2;
  }
  return 3;
}

export function validateProvider(value: string): AiProviderId {
  if (isReportProviderId(value)) {
    return value;
  }
  throw new CliUsageError(`Unknown provider: ${value}. Supported providers: ${REPORT_PROVIDER_IDS.join(", ")}.`);
}

export function parseParallelMode(value: string): ParallelMode {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "off" || trimmed === "auto") {
    return trimmed;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new CliUsageError("Option --parallel must be off, auto, or an integer from 1 to 5.");
  }
  return parsed;
}

function requireNonEmpty(optionName: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CliUsageError(`Option --${optionName} must not be empty.`);
  }
  return trimmed;
}

function splitPatterns(value: string): string[] {
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function validatePhase(value: string): string {
  if (value === "all") {
    return value;
  }

  if (!PHASE_IDS.has(value)) {
    throw new CliUsageError(`Unknown phase: ${value}`);
  }

  return value;
}

function parsePositiveMinutes(optionName: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliUsageError(`Option --${optionName} must be a positive number of minutes.`);
  }
  const seconds = Math.ceil(parsed * 60);
  if (seconds < 1) {
    throw new CliUsageError(`Option --${optionName} must be at least one second.`);
  }
  return seconds;
}

function parsePositiveInteger(optionName: string, value: string, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new CliUsageError(`Option --${optionName} must be an integer from 1 to ${max}.`);
  }
  return parsed;
}

function validateExportFormat(value: string): ReportExportFormat {
  if (value === "sarif" || value === "html" || value === "jsonl" || value === "github") {
    return value;
  }
  throw new CliUsageError("Option --export must contain sarif, html, jsonl, or github.");
}

function validateCompareFormat(value: string): CompareFormat {
  if (value === "markdown" || value === "json" || value === "html") {
    return value;
  }
  throw new CliUsageError("Option --format must be markdown, json, or html.");
}

function validateCiTemplate(value: string): NonNullable<AuditOptions["ciTemplate"]> {
  if (value === "pr-light" || value === "security" || value === "release-readiness" || value === "scheduled-audit") {
    return value;
  }
  throw new CliUsageError("Option --template must be pr-light, security, release-readiness, or scheduled-audit.");
}

function validateAuditProfile(value: string): AuditProfileId {
  if (
    value === "quick" ||
    value === "security" ||
    value === "pr-review" ||
    value === "release-readiness" ||
    value === "architecture"
  ) {
    return value;
  }
  throw new CliUsageError("Option --audit-profile must be quick, security, pr-review, release-readiness, or architecture.");
}

function validateReviewMode(value: string): ReviewMode {
  if (value === "default" || value === "deslopify" || value === "security" || value === "test-gaps") {
    return value;
  }
  throw new CliUsageError("Option --review-mode must be default, deslopify, security, or test-gaps.");
}

export function validateSandbox(value: string): SandboxMode {
  if (value === "read-only" || value === "workspace-write") {
    return value;
  }

  if (value === "danger-full-access" || value === "full-access") {
    throw new CliUsageError(
      "Dangerous sandbox mode rejected. RepoVista supports only read-only and workspace-write in the MVP."
    );
  }

  throw new CliUsageError(`Unknown sandbox mode: ${value}`);
}

function validateFindingStatus(value: string): FindingStatus {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "fixed" ||
    normalized === "false-positive" ||
    normalized === "wont-fix" ||
    normalized === "uncertain"
  ) {
    return normalized;
  }
  throw new CliUsageError("Option --status must be open, fixed, false-positive, wont-fix, or uncertain.");
}

export function renderHelp(): string {
  return renderCliHelp();
}
