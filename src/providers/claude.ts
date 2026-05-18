import type { ProviderRunRequest } from "../types.js";
import type { ReportProvider } from "./types.js";

export const CLAUDE_REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export const claudeProvider: ReportProvider = {
  id: "claude",
  displayName: "Claude Code CLI",
  executable: "claude",
  outputMode: "stdout",
  versionArgs: ["--version"],
  buildArgs: buildClaudeExecArgs,
  classifyError: classifyClaudeError,
  stdoutLogExtension: () => ".log"
};

export function buildClaudeExecArgs(request: ProviderRunRequest): string[] {
  const args = [
    "--print",
    "--output-format",
    "text",
    "--input-format",
    "text",
    "--no-session-persistence",
    "--permission-mode",
    request.sandbox === "read-only" ? "plan" : "default",
    "--add-dir",
    request.projectRoot
  ];

  if (request.model) {
    args.push("--model", request.model);
  }

  if (request.reasoning) {
    args.push("--effort", request.reasoning);
  }

  return args;
}

function classifyClaudeError(stderrText: string, code: number | null): string {
  const lower = stderrText.toLowerCase();
  if (lower.includes("auth") || lower.includes("login") || lower.includes("api key")) {
    return "Claude Code CLI appears to be unauthenticated. Sign in to Claude Code or configure an Anthropic API key and start RepoVista again.";
  }
  if (lower.includes("permission")) {
    return "Claude Code CLI stopped because a permission was denied. Check Claude Code permissions and retry the RepoVista run.";
  }
  return `Claude Code CLI run exited with code ${code ?? "unknown"}.`;
}
