import type { AiProviderId, ProviderCapabilities, ProviderRunRequest } from "../types.js";

export type ProviderOutputMode = "report-file" | "stdout";

export interface ReportProvider {
  id: AiProviderId;
  displayName: string;
  executable: string;
  outputMode: ProviderOutputMode;
  versionArgs: string[];
  capabilities: ProviderCapabilities;
  buildArgs(request: ProviderRunRequest): string[];
  classifyError(stderrText: string, code: number | null): string;
  stdoutLogExtension(request: ProviderRunRequest): string;
}
