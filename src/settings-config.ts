import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isReportProviderId } from "./providers/index.js";
import type { AiProviderId, AuditOptions, ParallelMode, ReportExportFormat, ReviewMode, SandboxMode } from "./types.js";

export interface RepoVistaSettings {
  provider?: AiProviderId;
  parallel?: ParallelMode;
  model?: string;
  profile?: string;
  reasoning?: string;
  fastMode?: boolean;
  sandbox?: SandboxMode;
  language?: string;
  publishLanguage?: string;
  outDir?: string;
  includes?: string[];
  ignores?: string[];
  runChecks?: boolean;
  checkCommands?: string[];
  checkTimeoutSeconds?: number;
  phaseTimeoutSeconds?: number;
  strictReports?: boolean;
  repairReports?: boolean;
  repairAttempts?: number;
  deepReview?: boolean;
  snapshot?: boolean;
  failOnDrift?: boolean;
  failOnWeakEvidence?: boolean;
  minQualityScore?: number;
  maxCritical?: number;
  maxHigh?: number;
  maxMedium?: number;
  reviewMode?: ReviewMode;
  promptFile?: string;
  exportFormats?: ReportExportFormat[];
  json?: boolean;
  keepLogs?: boolean;
  progress?: boolean;
  ci?: boolean;
  failOnCritical?: boolean;
  auditProfile?: AuditOptions["auditProfile"];
  workspace?: string;
  allWorkspaces?: boolean;
  incremental?: boolean;
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
    parallelExplicit: settings.parallel !== undefined ? true : defaults.parallelExplicit,
    outDir: settings.outDir ?? defaults.outDir,
    model: settings.model ?? defaults.model,
    profile: settings.profile ?? defaults.profile,
    reasoning: settings.reasoning ?? defaults.reasoning,
    fastMode: settings.fastMode ?? defaults.fastMode,
    sandbox: settings.sandbox ?? defaults.sandbox,
    language: settings.language ?? defaults.language,
    publishLanguage: settings.publishLanguage ?? defaults.publishLanguage,
    json: settings.json ?? defaults.json,
    keepLogs: settings.keepLogs ?? defaults.keepLogs,
    progress: settings.progress ?? defaults.progress,
    ci: settings.ci ?? defaults.ci,
    failOnCritical: settings.failOnCritical ?? defaults.failOnCritical,
    auditProfile: settings.auditProfile ?? defaults.auditProfile,
    workspace: settings.workspace ?? defaults.workspace,
    allWorkspaces: settings.allWorkspaces ?? defaults.allWorkspaces,
    incremental: settings.incremental ?? defaults.incremental,
    runChecks: settings.runChecks ?? defaults.runChecks,
    runChecksExplicit: settings.runChecks !== undefined ? true : defaults.runChecksExplicit,
    checkCommands: settings.checkCommands !== undefined ? [...settings.checkCommands] : [...defaults.checkCommands],
    checkTimeoutSeconds: settings.checkTimeoutSeconds ?? defaults.checkTimeoutSeconds,
    phaseTimeoutSeconds: settings.phaseTimeoutSeconds ?? defaults.phaseTimeoutSeconds,
    strictReports: settings.strictReports ?? defaults.strictReports,
    strictReportsExplicit: settings.strictReports !== undefined ? true : defaults.strictReportsExplicit,
    repairReports: settings.repairReports ?? defaults.repairReports,
    repairReportsExplicit: settings.repairReports !== undefined ? true : defaults.repairReportsExplicit,
    repairAttempts: settings.repairAttempts ?? defaults.repairAttempts,
    deepReview: settings.deepReview ?? defaults.deepReview,
    deepReviewExplicit: settings.deepReview !== undefined ? true : defaults.deepReviewExplicit,
    snapshot: settings.snapshot ?? defaults.snapshot,
    failOnDrift: settings.failOnDrift ?? defaults.failOnDrift,
    failOnWeakEvidence: settings.failOnWeakEvidence ?? defaults.failOnWeakEvidence,
    minQualityScore: settings.minQualityScore ?? defaults.minQualityScore,
    maxCritical: settings.maxCritical ?? defaults.maxCritical,
    maxHigh: settings.maxHigh ?? defaults.maxHigh,
    maxMedium: settings.maxMedium ?? defaults.maxMedium,
    reviewMode: settings.reviewMode ?? defaults.reviewMode,
    promptFile: settings.promptFile ?? defaults.promptFile,
    exportFormats: settings.exportFormats !== undefined ? [...settings.exportFormats] : [...defaults.exportFormats],
    exportFormatsExplicit: settings.exportFormats !== undefined ? true : defaults.exportFormatsExplicit,
    includes: settings.includes !== undefined ? [...settings.includes] : [...defaults.includes],
    ignores: settings.ignores !== undefined ? [...settings.ignores] : [...defaults.ignores],
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

  for (const key of ["model", "profile", "reasoning", "language", "publishLanguage", "outDir", "workspace", "promptFile"] as const) {
    const value = settings[key];
    if (typeof value === "string" && value.trim()) {
      sanitized[key] = value.trim();
    }
  }

  if (settings.sandbox === "read-only" || settings.sandbox === "workspace-write") {
    sanitized.sandbox = settings.sandbox;
  }

  if (
    settings.auditProfile === "quick" ||
    settings.auditProfile === "security" ||
    settings.auditProfile === "pr-review" ||
    settings.auditProfile === "release-readiness" ||
    settings.auditProfile === "architecture"
  ) {
    sanitized.auditProfile = settings.auditProfile;
  }

  if (
    settings.reviewMode === "default" ||
    settings.reviewMode === "deslopify" ||
    settings.reviewMode === "security" ||
    settings.reviewMode === "test-gaps"
  ) {
    sanitized.reviewMode = settings.reviewMode;
  }

  for (const key of ["includes", "ignores", "checkCommands"] as const) {
    if (Array.isArray(settings[key])) {
      const values = settings[key]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
      sanitized[key] = Array.from(new Set(values));
    }
  }

  if (Array.isArray(settings.exportFormats)) {
    const values = settings.exportFormats.filter((value): value is ReportExportFormat =>
      value === "sarif" || value === "html" || value === "jsonl" || value === "github"
    );
    sanitized.exportFormats = Array.from(new Set(values));
  }

  for (const key of ["checkTimeoutSeconds", "phaseTimeoutSeconds", "repairAttempts", "minQualityScore", "maxCritical", "maxHigh", "maxMedium"] as const) {
    const value = settings[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      sanitized[key] = key === "minQualityScore"
        ? Math.max(0, Math.min(100, Math.round(value)))
        : Math.max(key === "repairAttempts" || key === "checkTimeoutSeconds" || key === "phaseTimeoutSeconds" ? 1 : 0, Math.round(value));
    }
  }

  for (const key of ["fastMode", "json", "keepLogs", "progress", "ci", "failOnCritical", "runChecks", "strictReports", "repairReports", "deepReview", "snapshot", "failOnDrift", "failOnWeakEvidence", "allWorkspaces", "incremental"] as const) {
    if (typeof settings[key] === "boolean") {
      sanitized[key] = settings[key];
    }
  }

  return sanitized;
}
