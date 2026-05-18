import type { AiProviderId, ProviderRunRequest } from "../types.js";

export type ProviderOutputMode = "report-file" | "stdout";

export interface ReportProvider {
  id: AiProviderId;
  displayName: string;
  executable: string;
  outputMode: ProviderOutputMode;
  versionArgs: string[];
  buildArgs(request: ProviderRunRequest): string[];
  classifyError(stderrText: string, code: number | null): string;
  stdoutLogExtension(request: ProviderRunRequest): string;
}
