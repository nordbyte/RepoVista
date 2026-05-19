import { aiderProvider } from "./aider.js";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import { geminiProvider } from "./gemini.js";
import { opencodeProvider } from "./opencode.js";
import { loadPluginProviders } from "./plugin.js";
import type { ReportProvider } from "./types.js";
import type { AiProviderId } from "../types.js";

export const REPORT_PROVIDERS: ReportProvider[] = dedupeProviders([
  codexProvider,
  claudeProvider,
  geminiProvider,
  opencodeProvider,
  aiderProvider,
  ...loadPluginProviders()
]);
export const REPORT_PROVIDER_IDS = REPORT_PROVIDERS.map((provider) => provider.id) as AiProviderId[];

export function isReportProviderId(value: string): value is AiProviderId {
  return REPORT_PROVIDER_IDS.includes(value as AiProviderId);
}

export function getReportProvider(id: AiProviderId): ReportProvider {
  const provider = REPORT_PROVIDERS.find((item) => item.id === id);
  if (!provider) {
    throw new Error(`Unknown report provider: ${id}`);
  }
  return provider;
}

function dedupeProviders(providers: ReportProvider[]): ReportProvider[] {
  const seen = new Set<string>();
  const result: ReportProvider[] = [];
  for (const provider of providers) {
    if (seen.has(provider.id)) {
      continue;
    }
    seen.add(provider.id);
    result.push(provider);
  }
  return result;
}
