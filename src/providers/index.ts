import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import type { ReportProvider } from "./types.js";
import type { AiProviderId } from "../types.js";

export const REPORT_PROVIDERS = [codexProvider, claudeProvider] as const;
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
