import { RepoVistaError } from "./errors.js";
import { parseParallelMode, validateProvider, validateSandbox } from "./options.js";
import { loadSettings, saveSettings, type RepoVistaSettings } from "./settings-config.js";
import type { AuditOptions, ReportExportFormat } from "./types.js";

const SETTING_KEYS = new Set<keyof RepoVistaSettings>([
  "provider",
  "parallel",
  "model",
  "profile",
  "reasoning",
  "fastMode",
  "sandbox",
  "language",
  "outDir",
  "includes",
  "ignores",
  "runChecks",
  "checkCommands",
  "checkTimeoutSeconds",
  "phaseTimeoutSeconds",
  "strictReports",
  "repairReports",
  "repairAttempts",
  "exportFormats",
  "json",
  "keepLogs",
  "progress",
  "ci",
  "failOnCritical"
]);

export async function runSettingsGetCommand(options: AuditOptions): Promise<string> {
  const settings = await loadSettings();
  if (!options.settingsKey) {
    return `${JSON.stringify(settings, null, 2)}\n`;
  }
  const key = normalizeSettingKey(options.settingsKey);
  return `${JSON.stringify(settings[key] ?? null, null, 2)}\n`;
}

export async function runSettingsSetCommand(options: AuditOptions): Promise<string> {
  if (!options.settingsKey || options.settingsValue === undefined) {
    throw new RepoVistaError("Command settings set requires a key and value.");
  }
  const key = normalizeSettingKey(options.settingsKey);
  const settings = await loadSettings();
  settings[key] = parseSettingValue(key, options.settingsValue) as never;
  await saveSettings(settings);
  return `Saved RepoVista setting ${key}.\n`;
}

export async function runSettingsResetCommand(options: AuditOptions): Promise<string> {
  const settings = await loadSettings();
  if (!options.settingsKey) {
    await saveSettings({});
    return "Reset all RepoVista settings.\n";
  }
  const key = normalizeSettingKey(options.settingsKey);
  delete settings[key];
  await saveSettings(settings);
  return `Reset RepoVista setting ${key}.\n`;
}

function normalizeSettingKey(value: string): keyof RepoVistaSettings {
  if (SETTING_KEYS.has(value as keyof RepoVistaSettings)) {
    return value as keyof RepoVistaSettings;
  }
  throw new RepoVistaError(`Unknown setting: ${value}. Supported settings: ${Array.from(SETTING_KEYS).join(", ")}.`);
}

function parseSettingValue(key: keyof RepoVistaSettings, rawValue: string): RepoVistaSettings[keyof RepoVistaSettings] {
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
    case "json":
    case "keepLogs":
    case "progress":
    case "ci":
    case "failOnCritical":
      return parseBoolean(rawValue, key);
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
