import type { ProviderRunRequest } from "../types.js";
import type { ReportProvider } from "./types.js";

export const codexProvider: ReportProvider = {
  id: "codex",
  displayName: "Codex CLI",
  executable: "codex",
  outputMode: "report-file",
  versionArgs: ["--version"],
  capabilities: {
    outputSchema: true,
    readOnlySandbox: true,
    workspaceWrite: true,
    jsonEvents: true,
    promptFile: false
  },
  buildArgs: buildCodexExecArgs,
  classifyError: classifyCodexError,
  stdoutLogExtension: (request) => request.jsonEvents ? ".jsonl" : ".log"
};

export function buildCodexExecArgs(request: ProviderRunRequest): string[] {
  const args = [
    "exec",
    "--cd",
    request.projectRoot,
    "--config",
    'approval_policy="never"',
    "--sandbox",
    request.sandbox,
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--output-last-message",
    request.structuredOutputPath ?? request.reportPath
  ];

  if (request.outputSchemaPath) {
    args.push("--output-schema", request.outputSchemaPath);
  }

  if (request.model) {
    args.push("--model", request.model);
  }

  if (request.profile) {
    args.push("--profile", request.profile);
  }

  if (request.reasoning) {
    args.push("--config", `model_reasoning_effort="${request.reasoning}"`);
  }

  if (request.fastMode) {
    args.push("--config", 'service_tier="fast"');
  }

  if (request.jsonEvents) {
    args.push("--json");
  }

  args.push("-");
  return args;
}

function classifyCodexError(stderrText: string, code: number | null): string {
  const lower = stderrText.toLowerCase();
  if (lower.includes("auth") || lower.includes("login") || lower.includes("api key")) {
    return "Codex CLI appears to be unauthenticated. Sign in to the Codex CLI and start RepoVista again.";
  }
  return `Codex CLI run exited with code ${code ?? "unknown"}.`;
}
