import { CliUsageError } from "./errors.js";
import type { AuditOptions, CliParseResult, SandboxMode } from "./types.js";

const DEFAULT_OPTIONS: AuditOptions = {
  command: "audit",
  outDir: ".repovista",
  sandbox: "read-only",
  language: "Deutsch",
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
  "sandbox",
  "language",
  "include",
  "ignore"
]);

const BOOLEAN_OPTIONS = new Set([
  "json",
  "ci",
  "fail-on-critical",
  "no-progress",
  "keep-logs",
  "version",
  "help"
]);

export function parseCliArgs(argv: string[]): CliParseResult {
  const options: AuditOptions = {
    ...DEFAULT_OPTIONS,
    includes: [],
    ignores: []
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
      throw new CliUsageError(`Unbekannte Kurzoption: ${arg}`);
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    const name = equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;
    const inlineValue = equalsIndex >= 0 ? withoutPrefix.slice(equalsIndex + 1) : undefined;

    if (VALUE_OPTIONS.has(name)) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError(`Option --${name} benötigt einen Wert.`);
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      applyValueOption(options, name, value);
      continue;
    }

    if (!BOOLEAN_OPTIONS.has(name)) {
      throw new CliUsageError(`Unbekannte Option: --${name}`);
    }

    if (inlineValue !== undefined) {
      throw new CliUsageError(`Option --${name} erwartet keinen Wert.`);
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
    throw new CliUsageError(`Zu viele Positionsargumente: ${positionals.join(" ")}`);
  }

  const command = positionals[0] ?? "audit";
  if (command === "help") {
    wantsHelp = true;
  } else if (command === "version") {
    wantsVersion = true;
  } else if (command !== "audit") {
    throw new CliUsageError(`Unbekannter Befehl: ${command}`);
  }

  if (wantsVersion) {
    return { action: "version", options };
  }

  if (wantsHelp) {
    return { action: "help", options };
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
    throw new CliUsageError(`Option --${optionName} darf nicht leer sein.`);
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
      "Gefährlicher Sandbox-Modus abgelehnt. RepoVista unterstützt im MVP nur read-only und workspace-write."
    );
  }

  throw new CliUsageError(`Unbekannter Sandbox-Modus: ${value}`);
}

export function renderHelp(): string {
  return `RepoVista - Codex-gestützte Read-only-Repository-Audits

Usage:
  repovista [options]
  repovista audit [options]

Commands:
  audit                 Vollständigen Audit im aktuellen Verzeichnis ausführen
  help                  Hilfe anzeigen
  version               Version anzeigen

Options:
  --out <dir>           Zielordner für Reports (Standard: .repovista)
  --model <name>        Codex-Modell überschreiben
  --profile <name>      Codex-Profil aus der Codex-Konfiguration verwenden
  --sandbox <mode>      Codex-Sandbox: read-only oder workspace-write (Standard: read-only)
  --language <name>     Sprache der Reports (Standard: Deutsch)
  --json                Metadaten und Codex-JSONL-Events speichern
  --include <patterns>  Zusätzliche Include-Patterns für Inventar/Kontext
  --ignore <patterns>   Zusätzliche Ignore-Patterns
  --ci                  CI-Modus ohne Fortschrittsausgabe
  --fail-on-critical    Im CI-Modus bei kritischen Findings mit Exit-Code 2 beenden
  --no-progress         Fortschrittsausgabe reduzieren
  --keep-logs           Technische Codex-Logs speichern
  --version             Version anzeigen
  --help                Hilfe anzeigen
`;
}
