import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./process-runner.js";

export interface CodexReasoningLevel {
  effort: string;
  description?: string;
}

export interface CodexModelInfo {
  slug: string;
  displayName: string;
  description?: string;
  defaultReasoning?: string;
  supportedReasoning: CodexReasoningLevel[];
  supportsFastMode: boolean;
}

export interface CodexConfigDefaults {
  model?: string;
  reasoning?: string;
}

interface RawModelCatalog {
  models?: Array<{
    slug?: string;
    display_name?: string;
    description?: string;
    default_reasoning_level?: string;
    supported_reasoning_levels?: CodexReasoningLevel[];
    additional_speed_tiers?: string[];
    service_tiers?: Array<{ id?: string }>;
  }>;
}

const CODEX_DEBUG_MODELS_TIMEOUT_MS = 10_000;
const MAX_CODEX_DEBUG_MODELS_OUTPUT = 2_000_000;

export const FALLBACK_CODEX_MODELS: CodexModelInfo[] = [
  model("gpt-5.5", "GPT-5.5", "medium", true),
  model("gpt-5.4", "gpt-5.4", "medium", true),
  model("gpt-5.4-mini", "GPT-5.4-Mini", "medium", false),
  model("gpt-5.3-codex", "gpt-5.3-codex", "medium", false),
  model("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark", "high", false),
  model("gpt-5.2", "gpt-5.2", "medium", false)
];

export async function loadCodexModels(): Promise<CodexModelInfo[]> {
  try {
    const raw = await runCodexDebugModels();
    const parsed = parseCodexModelCatalog(raw);
    return parsed.length ? parsed : FALLBACK_CODEX_MODELS;
  } catch {
    return FALLBACK_CODEX_MODELS;
  }
}

export function parseCodexModelCatalog(raw: string): CodexModelInfo[] {
  const catalog = JSON.parse(raw) as RawModelCatalog;
  return (catalog.models ?? [])
    .filter((item) => typeof item.slug === "string" && item.slug.length > 0)
    .map((item) => ({
      slug: item.slug as string,
      displayName: item.display_name || item.slug as string,
      description: item.description,
      defaultReasoning: item.default_reasoning_level,
      supportedReasoning: item.supported_reasoning_levels ?? [],
      supportsFastMode: Boolean(
        item.additional_speed_tiers?.includes("fast") ||
        item.service_tiers?.some((tier) => tier.id === "fast" || tier.id === "priority")
      )
    }));
}

export function reasoningOptionsForModel(models: CodexModelInfo[], selectedModel?: string): CodexReasoningLevel[] {
  const modelInfo = selectedModel ? models.find((item) => item.slug === selectedModel) : undefined;
  const levels = modelInfo?.supportedReasoning.length
    ? modelInfo.supportedReasoning
    : models.flatMap((item) => item.supportedReasoning);
  const byEffort = new Map<string, CodexReasoningLevel>();

  for (const level of levels) {
    if (level.effort && !byEffort.has(level.effort)) {
      byEffort.set(level.effort, level);
    }
  }

  if (!byEffort.size) {
    for (const effort of ["low", "medium", "high", "xhigh"]) {
      byEffort.set(effort, { effort });
    }
  }

  return Array.from(byEffort.values());
}

export async function resolveCodexDefaultModel(configPath = defaultCodexConfigPath()): Promise<string | undefined> {
  const configured = await loadCodexConfigDefaults(configPath);
  return configured.model ?? FALLBACK_CODEX_MODELS[0]?.slug;
}

export async function loadCodexConfigDefaults(configPath = defaultCodexConfigPath()): Promise<CodexConfigDefaults> {
  try {
    return parseCodexConfigDefaults(await readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

export function parseCodexConfigDefaults(raw: string): CodexConfigDefaults {
  const defaults: CodexConfigDefaults = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("[")) {
      break;
    }
    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = parseTomlScalar(match[2]);
    if (key === "model" && value) {
      defaults.model = value;
    } else if (key === "model_reasoning_effort" && value) {
      defaults.reasoning = value;
    }
  }
  return defaults;
}

function runCodexDebugModels(): Promise<string> {
  return runProcess("codex", ["debug", "models"], {
    timeoutMs: CODEX_DEBUG_MODELS_TIMEOUT_MS,
    stdoutLimit: MAX_CODEX_DEBUG_MODELS_OUTPUT,
    stderrLimit: MAX_CODEX_DEBUG_MODELS_OUTPUT,
    maskOutput: false
  }).then((result) => {
    if (result.exitCode === 0) {
      return result.stdout;
    }
    throw new Error(result.error ?? (result.stderr.trim() || `codex debug models exited with code ${result.exitCode ?? "unknown"}`));
  });
}

function defaultCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  return path.join(codexHome, "config.toml");
}

function parseTomlScalar(raw: string): string | undefined {
  const value = stripTomlComment(raw).trim();
  if (!value) {
    return undefined;
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim() || undefined;
  }
  return value.split(/\s+/)[0]?.trim() || undefined;
}

function stripTomlComment(raw: string): string {
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote === "\"") {
      escaped = true;
      continue;
    }
    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }
    if (char === "#" && !quote) {
      return raw.slice(0, index);
    }
  }
  return raw;
}

function model(slug: string, displayName: string, defaultReasoning: string, supportsFastMode: boolean): CodexModelInfo {
  return {
    slug,
    displayName,
    defaultReasoning,
    supportedReasoning: ["low", "medium", "high", "xhigh"].map((effort) => ({ effort })),
    supportsFastMode
  };
}
