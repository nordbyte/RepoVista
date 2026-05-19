import type { ProviderRunRequest } from "../types.js";
import type { ReportProvider } from "./types.js";

export const aiderProvider: ReportProvider = {
  id: "aider",
  displayName: "Aider CLI",
  executable: "aider",
  outputMode: "stdout",
  versionArgs: ["--version"],
  capabilities: {
    outputSchema: false,
    readOnlySandbox: true,
    workspaceWrite: false,
    jsonEvents: false,
    promptFile: true
  },
  buildArgs: buildAiderArgs,
  classifyError: classifyAiderError,
  stdoutLogExtension: () => ".log"
};

export function buildAiderArgs(request: ProviderRunRequest): string[] {
  const args = ["--yes-always", "--no-auto-commits", "--no-git", "--chat-mode", "ask"];
  if (request.model) {
    args.push("--model", request.model);
  }
  if (request.promptFilePath) {
    args.push("--message-file", request.promptFilePath);
  } else {
    args.push("--message", request.prompt);
  }
  return args;
}

function classifyAiderError(stderrText: string, code: number | null): string {
  const lower = stderrText.toLowerCase();
  if (lower.includes("auth") || lower.includes("login") || lower.includes("api key")) {
    return "Aider CLI appears to be unauthenticated. Configure the required model credentials and start RepoVista again.";
  }
  return `Aider CLI run exited with code ${code ?? "unknown"}.`;
}
