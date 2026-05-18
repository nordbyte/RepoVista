import {
  loadCodexModels,
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

export async function loadProviderModels(provider: AiProviderId): Promise<ProviderModelInfo[]> {
  if (provider === "codex") {
    return loadCodexModels();
  }
  return FALLBACK_CLAUDE_MODELS;
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
