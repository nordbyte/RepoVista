import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isReportProviderId } from "./providers/index.js";
import type { AiProviderId, AuditOptions, ParallelMode, SandboxMode } from "./types.js";

export interface RepoVistaSettings {
  provider?: AiProviderId;
  parallel?: ParallelMode;
  model?: string;
  profile?: string;
  reasoning?: string;
  fastMode?: boolean;
  sandbox?: SandboxMode;
  language?: string;
  outDir?: string;
  includes?: string[];
  ignores?: string[];
  runChecks?: boolean;
  checkCommands?: string[];
  checkTimeoutSeconds?: number;
  phaseTimeoutSeconds?: number;
  strictReports?: boolean;
  json?: boolean;
  keepLogs?: boolean;
  progress?: boolean;
  ci?: boolean;
  failOnCritical?: boolean;
}

export function getSettingsPath(): string {
  if (process.env.REPOVISTA_CONFIG) {
    return path.resolve(process.env.REPOVISTA_CONFIG);
  }

  const configHome = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  return path.join(configHome, "repovista", "settings.json");
}

export async function loadSettings(settingsPath = getSettingsPath()): Promise<RepoVistaSettings> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    return sanitizeSettings(JSON.parse(raw) as RepoVistaSettings);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveSettings(settings: RepoVistaSettings, settingsPath = getSettingsPath()): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(sanitizeSettings(settings), null, 2)}\n`, "utf8");
}

export function applySettingsToDefaults(defaults: AuditOptions, settings: RepoVistaSettings): AuditOptions {
  return {
    ...defaults,
    provider: settings.provider ?? defaults.provider,
    parallel: settings.parallel ?? defaults.parallel,
    outDir: settings.outDir ?? defaults.outDir,
    model: settings.model ?? defaults.model,
    profile: settings.profile ?? defaults.profile,
    reasoning: settings.reasoning ?? defaults.reasoning,
    fastMode: settings.fastMode ?? defaults.fastMode,
    sandbox: settings.sandbox ?? defaults.sandbox,
    language: settings.language ?? defaults.language,
    json: settings.json ?? defaults.json,
    keepLogs: settings.keepLogs ?? defaults.keepLogs,
    progress: settings.progress ?? defaults.progress,
    ci: settings.ci ?? defaults.ci,
    failOnCritical: settings.failOnCritical ?? defaults.failOnCritical,
    runChecks: settings.runChecks ?? defaults.runChecks,
    checkCommands: settings.checkCommands ? [...settings.checkCommands] : [...defaults.checkCommands],
    checkTimeoutSeconds: settings.checkTimeoutSeconds ?? defaults.checkTimeoutSeconds,
    phaseTimeoutSeconds: settings.phaseTimeoutSeconds ?? defaults.phaseTimeoutSeconds,
    strictReports: settings.strictReports ?? defaults.strictReports,
    includes: settings.includes ? [...settings.includes] : [...defaults.includes],
    ignores: settings.ignores ? [...settings.ignores] : [...defaults.ignores],
    phases: [...defaults.phases]
  };
}

export function sanitizeSettings(settings: RepoVistaSettings): RepoVistaSettings {
  const sanitized: RepoVistaSettings = {};

  if (typeof settings.provider === "string" && isReportProviderId(settings.provider)) {
    sanitized.provider = settings.provider;
  }

  if (settings.parallel === "off" || settings.parallel === "auto") {
    sanitized.parallel = settings.parallel;
  } else if (typeof settings.parallel === "number" && Number.isInteger(settings.parallel) && settings.parallel >= 1 && settings.parallel <= 5) {
    sanitized.parallel = settings.parallel;
  }

  for (const key of ["model", "profile", "reasoning", "language", "outDir"] as const) {
    const value = settings[key];
    if (typeof value === "string" && value.trim()) {
      sanitized[key] = value.trim();
    }
  }

  if (settings.sandbox === "read-only" || settings.sandbox === "workspace-write") {
    sanitized.sandbox = settings.sandbox;
  }

  for (const key of ["includes", "ignores", "checkCommands"] as const) {
    if (Array.isArray(settings[key])) {
      const values = settings[key]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length) {
        sanitized[key] = Array.from(new Set(values));
      }
    }
  }

  for (const key of ["checkTimeoutSeconds", "phaseTimeoutSeconds"] as const) {
    const value = settings[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      sanitized[key] = Math.round(value);
    }
  }

  for (const key of ["fastMode", "json", "keepLogs", "progress", "ci", "failOnCritical", "runChecks", "strictReports"] as const) {
    if (typeof settings[key] === "boolean") {
      sanitized[key] = settings[key];
    }
  }

  return sanitized;
}
