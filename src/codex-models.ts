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

function model(slug: string, displayName: string, defaultReasoning: string, supportsFastMode: boolean): CodexModelInfo {
  return {
    slug,
    displayName,
    defaultReasoning,
    supportedReasoning: ["low", "medium", "high", "xhigh"].map((effort) => ({ effort })),
    supportsFastMode
  };
}
