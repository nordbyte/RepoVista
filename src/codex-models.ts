import { spawn } from "node:child_process";

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
        item.service_tiers?.some((tier) => tier.id === "priority")
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
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["debug", "models"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `codex debug models exited with code ${code ?? "unknown"}`));
      }
    });
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
