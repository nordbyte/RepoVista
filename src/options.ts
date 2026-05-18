import { CliUsageError } from "./errors.js";
import type { AuditOptions, CliParseResult, SandboxMode } from "./types.js";

export const DEFAULT_OPTIONS: AuditOptions = {
  command: "audit",
  outDir: ".repovista",
  sandbox: "read-only",
  language: "English",
  fastMode: false,
  json: false,
  includes: [],
  ignores: [],
  ci: false,
  failOnCritical: false,
  progress: true,
  keepLogs: false
};

const VALUE_OPTIONS = new Set([
  "out",
  "model",
  "profile",
  "reasoning",
  "sandbox",
  "language",
  "include",
  "ignore"
]);

const BOOLEAN_OPTIONS = new Set([
  "json",
  "ci",
  "fail-on-critical",
  "fast",
  "no-fast",
  "no-progress",
  "keep-logs",
  "version",
  "help"
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
      case "no-progress":
        options.progress = false;
        break;
      case "keep-logs":
        options.keepLogs = true;
        break;
      case "version":
        wantsVersion = true;
        break;
      case "help":
        wantsHelp = true;
        break;
    }
  }

  if (positionals.length > 1) {
    throw new CliUsageError(`Too many positional arguments: ${positionals.join(" ")}`);
  }

  const command = positionals[0] ?? "audit";
  if (command === "help") {
    wantsHelp = true;
  } else if (command === "version") {
    wantsVersion = true;
  } else if (command !== "audit" && command !== "settings") {
    throw new CliUsageError(`Unknown command: ${command}`);
  }

  if (wantsVersion) {
    return { action: "version", options };
  }

  if (wantsHelp) {
    return { action: "help", options };
  }

  if (command === "settings") {
    return { action: "settings", options };
  }

  return { action: "audit", options };
}

function applyValueOption(options: AuditOptions, name: string, value: string): void {
  switch (name) {
    case "out":
      options.outDir = requireNonEmpty(name, value);
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
  }
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

export function renderHelp(): string {
  return `RepoVista - Codex-powered read-only repository audits

Usage:
  repovista [options]
  repovista audit [options]

Commands:
  audit                 Run a full audit in the current directory
  settings              Edit persisted default settings in an interactive menu
  help                  Show help
  version               Show version

Options:
  --out <dir>           Report output directory (default: .repovista)
  --model <name>        Override the Codex model
  --profile <name>      Use a Codex configuration profile
  --reasoning <effort>  Override Codex reasoning effort
  --fast                Use Codex fast service tier when supported
  --no-fast             Disable Codex fast service tier
  --sandbox <mode>      Codex sandbox: read-only or workspace-write (default: read-only)
  --language <name>     Report language (default: English)
  --json                Store metadata and Codex JSONL events
  --include <patterns>  Additional include patterns for inventory/context
  --ignore <patterns>   Additional ignore patterns
  --ci                  CI mode without progress output
  --fail-on-critical    Exit with code 2 in CI when critical findings are detected
  --no-progress         Reduce progress output
  --keep-logs           Store technical Codex logs
  --version             Show version
  --help                Show help
`;
}
