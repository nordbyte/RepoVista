import { RepoVistaError } from "./errors.js";
import { parseParallelMode, validateProvider, validateSandbox } from "./options.js";
import type { RepoVistaSettings } from "./settings-config.js";
import type { ReportExportFormat } from "./types.js";

export interface SettingDefinition {
  key: keyof RepoVistaSettings;
  type: "string" | "boolean" | "number" | "list" | "enum";
  help: string;
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { key: "provider", type: "enum", help: "Default report provider" },
  { key: "parallel", type: "enum", help: "Default parallel execution mode" },
  { key: "model", type: "string", help: "Default provider model" },
  { key: "profile", type: "string", help: "Default provider profile" },
  { key: "reasoning", type: "string", help: "Default reasoning effort" },
  { key: "fastMode", type: "boolean", help: "Use fast provider tier where supported" },
  { key: "sandbox", type: "enum", help: "Default provider sandbox mode" },
  { key: "language", type: "string", help: "Default report language" },
  { key: "outDir", type: "string", help: "Default report output directory" },
  { key: "includes", type: "list", help: "Default include patterns" },
  { key: "ignores", type: "list", help: "Default ignore patterns" },
  { key: "runChecks", type: "boolean", help: "Run local checks before audit" },
  { key: "checkCommands", type: "list", help: "Explicit local check commands" },
  { key: "checkTimeoutSeconds", type: "number", help: "Local check timeout in seconds" },
  { key: "phaseTimeoutSeconds", type: "number", help: "Provider phase timeout in seconds" },
  { key: "strictReports", type: "boolean", help: "Fail phases on report quality warnings" },
  { key: "repairReports", type: "boolean", help: "Repair reports that miss quality gates" },
  { key: "repairAttempts", type: "number", help: "Maximum report repair attempts" },
  { key: "deepReview", type: "boolean", help: "Run feature-sliced deep review passes" },
  { key: "exportFormats", type: "list", help: "Default finding export formats" },
  { key: "json", type: "boolean", help: "Keep JSON provider events/log metadata" },
  { key: "keepLogs", type: "boolean", help: "Keep technical provider logs" },
  { key: "progress", type: "boolean", help: "Show progress output" },
  { key: "ci", type: "boolean", help: "Use CI output defaults" },
  { key: "failOnCritical", type: "boolean", help: "Fail CI on critical findings" },
  { key: "auditProfile", type: "enum", help: "Built-in audit profile" },
  { key: "workspace", type: "string", help: "Default workspace name or path" },
  { key: "allWorkspaces", type: "boolean", help: "Include all detected workspaces" },
  { key: "incremental", type: "boolean", help: "Use project scan cache metadata" }
];

export const SETTING_KEYS = new Set(SETTING_DEFINITIONS.map((definition) => definition.key));

export function normalizeSettingKey(value: string): keyof RepoVistaSettings {
  if (SETTING_KEYS.has(value as keyof RepoVistaSettings)) {
    return value as keyof RepoVistaSettings;
  }
  throw new RepoVistaError(`Unknown setting: ${value}. Supported settings: ${Array.from(SETTING_KEYS).join(", ")}.`);
}

export function parseSettingValue(key: keyof RepoVistaSettings, rawValue: string): RepoVistaSettings[keyof RepoVistaSettings] {
  switch (key) {
    case "provider":
      return validateProvider(rawValue);
    case "parallel":
      return parseParallelMode(rawValue);
    case "sandbox":
      return validateSandbox(rawValue);
    case "fastMode":
    case "runChecks":
    case "strictReports":
    case "repairReports":
    case "deepReview":
    case "json":
    case "keepLogs":
    case "progress":
    case "ci":
    case "failOnCritical":
    case "allWorkspaces":
    case "incremental":
      return parseBoolean(rawValue, key);
    case "auditProfile":
      return parseAuditProfile(rawValue);
    case "includes":
    case "ignores":
    case "checkCommands":
      return splitList(rawValue);
    case "exportFormats":
      return splitList(rawValue).map(validateExportFormat);
    case "checkTimeoutSeconds":
    case "phaseTimeoutSeconds":
    case "repairAttempts":
      return parsePositiveInteger(rawValue, key);
    default:
      return rawValue.trim();
  }
}

function parseAuditProfile(value: string): RepoVistaSettings["auditProfile"] {
  const normalized = value.trim();
  if (
    normalized === "quick" ||
    normalized === "security" ||
    normalized === "pr-review" ||
    normalized === "release-readiness" ||
    normalized === "architecture"
  ) {
    return normalized;
  }
  throw new RepoVistaError("auditProfile supports quick, security, pr-review, release-readiness, and architecture.");
}

function parseBoolean(value: string, key: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new RepoVistaError(`Setting ${key} expects a boolean value.`);
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function validateExportFormat(value: string): ReportExportFormat {
  if (value === "sarif" || value === "html" || value === "jsonl" || value === "github") {
    return value;
  }
  throw new RepoVistaError("exportFormats supports sarif, html, jsonl, and github.");
}

function parsePositiveInteger(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RepoVistaError(`Setting ${key} expects a positive integer.`);
  }
  return parsed;
}
