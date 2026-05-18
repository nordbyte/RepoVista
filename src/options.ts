import { CliUsageError } from "./errors.js";
import { isReportProviderId, REPORT_PROVIDER_IDS } from "./providers/index.js";
import type { AiProviderId, AuditOptions, CliParseResult, FindingStatus, ParallelMode, SandboxMode } from "./types.js";

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
  ci: false,
  failOnCritical: false,
  progress: true,
  keepLogs: false
};

const VALUE_OPTIONS = new Set([
  "provider",
  "parallel",
  "out",
  "resume",
  "model",
  "profile",
  "reasoning",
  "sandbox",
  "language",
  "include",
  "ignore",
  "phase",
  "check",
  "check-timeout",
  "phase-timeout",
  "timeout",
  "since",
  "finding",
  "status",
  "note"
]);

const BOOLEAN_OPTIONS = new Set([
  "json",
  "ci",
  "fail-on-critical",
  "fast",
  "no-fast",
  "run-checks",
  "no-run-checks",
  "strict-reports",
  "no-strict-reports",
  "no-progress",
  "no-parallel",
  "keep-logs",
  "all",
  "version",
  "help"
]);

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
    ignores: [...defaults.ignores]
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

    if (VALUE_OPTIONS.has(name)) {
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

    if (!BOOLEAN_OPTIONS.has(name)) {
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
        break;
      case "no-run-checks":
        options.runChecks = false;
        break;
      case "strict-reports":
        options.strictReports = true;
        break;
      case "no-strict-reports":
        options.strictReports = false;
        break;
      case "no-progress":
        options.progress = false;
        break;
      case "no-parallel":
        options.parallel = "off";
        break;
      case "keep-logs":
        options.keepLogs = true;
        break;
      case "all":
        options.allFindings = true;
        break;
      case "version":
        wantsVersion = true;
        break;
      case "help":
        wantsHelp = true;
        break;
    }
  }

  if (positionals.length > 3) {
    throw new CliUsageError(`Too many positional arguments: ${positionals.join(" ")}`);
  }

  const command = positionals[0] ?? "audit";
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
    return { action: "compare", options };
  }

  if (command === "next") {
    if (positionals.length > 1) {
      throw new CliUsageError("Command next does not take positional arguments.");
    }
    return { action: "next", options };
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

  if (positionals.length > 1) {
    throw new CliUsageError(`Too many positional arguments: ${positionals.join(" ")}`);
  }

  if (command === "init") {
    return { action: "init", options };
  }

  if (command === "plan") {
    return { action: "plan", options };
  }

  if (command === "settings") {
    return { action: "settings", options };
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
    case "since":
      options.since = requireNonEmpty(name, value);
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
  }
}

function isCommand(value: string): value is CliParseResult["action"] {
  return value === "audit" ||
    value === "init" ||
    value === "plan" ||
    value === "settings" ||
    value === "compare" ||
    value === "next" ||
    value === "show" ||
    value === "triage" ||
    value === "revalidate";
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
  return Math.round(parsed * 60);
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
  return `RepoVista - AI-powered read-only repository audits

Usage:
  repovista [options]
  repovista audit [options]
  repovista init [options]
  repovista plan [options]
  repovista compare <old-run-dir> <new-run-dir>
  repovista next [--status <status>]
  repovista show <finding-id>
  repovista triage <finding-id> --status <status> [--note <text>]
  repovista revalidate <finding-id|--all>

Commands:
  audit                 Run a full audit in the current directory
  init                  Initialize or refresh the RepoVista project map
  plan                  Show the recommended parallel execution plan
  compare               Compare two RepoVista run directories
  next                  Show the next prioritized finding from the persistent finding state
  show                  Show one persisted finding with evidence and lifecycle history
  triage                Update the lifecycle status of one finding
  revalidate            Re-check finding evidence against the current checkout
  settings              Edit persisted default settings in an interactive menu
  help                  Show help
  version               Show version

Options:
  --provider <name>     Report provider: codex or claude (default: codex)
  --parallel <mode>     Parallel audit mode: off, auto, or 1-5 threads (default: off)
  --no-parallel         Disable saved parallel default
  --out <dir>           Report output directory (default: .repovista)
  --resume <run-dir>    Resume or complete an existing RepoVista run directory
  --since <git-ref>     Focus the audit on files changed since the given Git ref
  --model <name>        Override the provider model
  --profile <name>      Use a Codex configuration profile
  --reasoning <effort>  Override provider reasoning effort
  --fast                Use Codex fast service tier when supported
  --no-fast             Disable Codex fast service tier
  --sandbox <mode>      Provider sandbox: read-only or workspace-write (default: read-only)
  --language <name>     Report language (default: English)
  --json                Store metadata and provider logs/events
  --include <patterns>  Additional include patterns for inventory/context
  --ignore <patterns>   Additional ignore patterns
  --phase <id>          Run only selected phase(s); repeatable or comma-separated
  --run-checks          Run detected or explicit local check commands before analysis
  --no-run-checks       Disable saved run-checks default
  --check <command>     Add an explicit local check command for --run-checks
  --check-timeout <min> Timeout per local check command (default: 5)
  --timeout <min>       Timeout per provider phase (default: 30)
  --phase-timeout <min> Alias for --timeout
  --strict-reports      Fail phases when report quality gates warn
  --no-strict-reports   Disable saved strict report default
  --ci                  CI mode without progress output
  --fail-on-critical    Exit with code 2 in CI when critical findings are detected
  --no-progress         Reduce progress output
  --keep-logs           Store technical provider logs
  --finding <id>        Finding id for show, triage, or revalidate
  --status <status>     Finding status: open, fixed, false-positive, wont-fix, uncertain
  --note <text>         Triage note stored in finding history
  --all                 Include all finding statuses or revalidate all findings
  --version             Show version
  --help                Show help
`;
}
