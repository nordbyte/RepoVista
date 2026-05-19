import type { ProviderRunRequest } from "../types.js";
import type { ReportProvider } from "./types.js";

export const geminiProvider: ReportProvider = {
  id: "gemini",
  displayName: "Gemini CLI",
  executable: "gemini",
  outputMode: "stdout",
  versionArgs: ["--version"],
  capabilities: {
    outputSchema: false,
    readOnlySandbox: true,
    workspaceWrite: false,
    jsonEvents: false,
    promptFile: false
  },
  buildArgs: buildGeminiArgs,
  classifyError: classifyGeminiError,
  stdoutLogExtension: () => ".log"
};

export function buildGeminiArgs(request: ProviderRunRequest): string[] {
  const args: string[] = [];
  if (request.model) {
    args.push("--model", request.model);
  }
  return args;
}

function classifyGeminiError(stderrText: string, code: number | null): string {
  const lower = stderrText.toLowerCase();
  if (lower.includes("auth") || lower.includes("login") || lower.includes("api key")) {
    return "Gemini CLI appears to be unauthenticated. Authenticate Gemini CLI and start RepoVista again.";
  }
  return `Gemini CLI run exited with code ${code ?? "unknown"}.`;
}
