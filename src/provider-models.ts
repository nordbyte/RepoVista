import {
  loadCodexModels,
  resolveCodexDefaultModel,
  reasoningOptionsForModel,
  type CodexModelInfo,
  type CodexReasoningLevel
} from "./codex-models.js";
import { CLAUDE_REASONING_LEVELS } from "./providers/claude.js";
import type { AiProviderId } from "./types.js";

export type ProviderModelInfo = CodexModelInfo;
export type ProviderReasoningLevel = CodexReasoningLevel;

const FALLBACK_CLAUDE_MODELS: ProviderModelInfo[] = [
  claudeModel("sonnet", "Claude Sonnet", "Latest Claude Sonnet alias"),
  claudeModel("opus", "Claude Opus", "Latest Claude Opus alias"),
  claudeModel("haiku", "Claude Haiku", "Latest Claude Haiku alias")
];

const FALLBACK_GEMINI_MODELS: ProviderModelInfo[] = [
  genericModel("gemini-2.5-pro", "Gemini 2.5 Pro"),
  genericModel("gemini-2.5-flash", "Gemini 2.5 Flash")
];

const FALLBACK_OPENCODE_MODELS: ProviderModelInfo[] = [
  genericModel("anthropic/claude-sonnet-4-5", "Claude Sonnet via OpenCode"),
  genericModel("openai/gpt-5.5", "GPT-5.5 via OpenCode"),
  genericModel("google/gemini-2.5-pro", "Gemini 2.5 Pro via OpenCode")
];

const FALLBACK_AIDER_MODELS: ProviderModelInfo[] = [
  genericModel("sonnet", "Claude Sonnet"),
  genericModel("gpt-5.5", "GPT-5.5"),
  genericModel("gemini/gemini-2.5-pro", "Gemini 2.5 Pro")
];

export async function loadProviderModels(provider: AiProviderId): Promise<ProviderModelInfo[]> {
  if (provider === "codex") {
    return loadCodexModels();
  }
  if (provider === "claude") {
    return FALLBACK_CLAUDE_MODELS;
  }
  if (provider === "gemini") {
    return FALLBACK_GEMINI_MODELS;
  }
  if (provider === "opencode") {
    return FALLBACK_OPENCODE_MODELS;
  }
  if (provider === "aider") {
    return FALLBACK_AIDER_MODELS;
  }
  return [];
}

export async function resolveProviderDefaultModel(
  provider: AiProviderId,
  options: { profile?: string } = {}
): Promise<string | undefined> {
  if (provider === "codex") {
    return resolveCodexDefaultModel(undefined, options.profile);
  }
  if (provider === "claude") {
    return FALLBACK_CLAUDE_MODELS[0]?.slug;
  }
  if (provider === "gemini") {
    return FALLBACK_GEMINI_MODELS[0]?.slug;
  }
  if (provider === "opencode") {
    return FALLBACK_OPENCODE_MODELS[0]?.slug;
  }
  if (provider === "aider") {
    return FALLBACK_AIDER_MODELS[0]?.slug;
  }
  return undefined;
}

function genericModel(slug: string, displayName: string): ProviderModelInfo {
  return {
    slug,
    displayName,
    supportedReasoning: ["low", "medium", "high", "xhigh"].map((effort) => ({ effort })),
    supportsFastMode: false
  };
}

export function reasoningOptionsForProviderModel(
  provider: AiProviderId,
  models: ProviderModelInfo[],
  selectedModel?: string
): ProviderReasoningLevel[] {
  if (provider === "codex") {
    return reasoningOptionsForModel(models, selectedModel);
  }

  const modelInfo = selectedModel ? models.find((item) => item.slug === selectedModel) : undefined;
  return modelInfo?.supportedReasoning.length
    ? modelInfo.supportedReasoning
    : CLAUDE_REASONING_LEVELS.map((effort) => ({ effort }));
}

function claudeModel(slug: string, displayName: string, description: string): ProviderModelInfo {
  return {
    slug,
    displayName,
    description,
    supportedReasoning: CLAUDE_REASONING_LEVELS.map((effort) => ({ effort })),
    supportsFastMode: false
  };
}
