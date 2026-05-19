import { aiderProvider } from "./aider.js";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import { geminiProvider } from "./gemini.js";
import { opencodeProvider } from "./opencode.js";
import { loadPluginProviders, type ProviderPluginLoadContext } from "./plugin.js";
import type { ReportProvider } from "./types.js";
import type { AiProviderId } from "../types.js";

const BUILTIN_REPORT_PROVIDERS: ReportProvider[] = [
  codexProvider,
  claudeProvider,
  geminiProvider,
  opencodeProvider,
  aiderProvider
];

export let REPORT_PROVIDERS: ReportProvider[] = loadReportProviders();
export let REPORT_PROVIDER_IDS = REPORT_PROVIDERS.map((provider) => provider.id) as AiProviderId[];

export function loadReportProviders(context: ProviderPluginLoadContext = {}): ReportProvider[] {
  return dedupeProviders([
    ...BUILTIN_REPORT_PROVIDERS,
    ...loadPluginProviders(context)
  ]);
}

export function refreshReportProviders(context: ProviderPluginLoadContext = {}): ReportProvider[] {
  REPORT_PROVIDERS = loadReportProviders(context);
  REPORT_PROVIDER_IDS = REPORT_PROVIDERS.map((provider) => provider.id) as AiProviderId[];
  return REPORT_PROVIDERS;
}

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
