import type { ProviderRunRequest } from "../types.js";
import type { ReportProvider } from "./types.js";

export const opencodeProvider: ReportProvider = {
  id: "opencode",
  displayName: "OpenCode CLI",
  executable: "opencode",
  outputMode: "stdout",
  versionArgs: ["--version"],
  capabilities: {
    outputSchema: false,
    readOnlySandbox: true,
    workspaceWrite: false,
    jsonEvents: false,
    promptFile: false
  },
  buildArgs: buildOpenCodeArgs,
  classifyError: classifyOpenCodeError,
  stdoutLogExtension: () => ".log"
};

export function buildOpenCodeArgs(request: ProviderRunRequest): string[] {
  const args = ["run", "--dir", request.projectRoot];
  if (request.model) {
    args.push("--model", request.model);
  }
  if (request.reasoning) {
    args.push("--variant", request.reasoning);
  }
  args.push(request.prompt);
  return args;
}

function classifyOpenCodeError(stderrText: string, code: number | null): string {
  const lower = stderrText.toLowerCase();
  if (lower.includes("auth") || lower.includes("login") || lower.includes("api key") || lower.includes("credential")) {
    return "OpenCode CLI appears to be unauthenticated. Run `opencode auth login` and start RepoVista again.";
  }
  return `OpenCode CLI run exited with code ${code ?? "unknown"}.`;
}
