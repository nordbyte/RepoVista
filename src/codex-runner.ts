import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { CodexRunRequest, CodexRunResult } from "./types.js";

export type SpawnAdapter = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

const MAX_ERROR_TEXT = 8000;

export function buildCodexExecArgs(request: CodexRunRequest): string[] {
  const args = [
    "exec",
    "--cd",
    request.projectRoot,
    "--config",
    'approval_policy="never"',
    "--sandbox",
    request.sandbox,
    "--skip-git-repo-check",
    "--color",
    "never",
    "--output-last-message",
    request.reportPath
  ];

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
    args.push("--config", 'service_tier="priority"');
  }

  if (request.jsonEvents) {
    args.push("--json");
  }

  args.push("-");
  return args;
}

export async function runCodexPhase(
  request: CodexRunRequest,
  spawnAdapter: SpawnAdapter = spawn
): Promise<CodexRunResult> {
  const startedAt = Date.now();
  const args = buildCodexExecArgs(request);
  const shouldStoreLogs = request.keepLogs || request.jsonEvents;
  const stdoutLogPath = shouldStoreLogs && request.logsDir
    ? path.join(request.logsDir, `${request.phaseId}.stdout${request.jsonEvents ? ".jsonl" : ".log"}`)
    : undefined;
  const stderrLogPath = shouldStoreLogs && request.logsDir
    ? path.join(request.logsDir, `${request.phaseId}.stderr.log`)
    : undefined;

  if (request.logsDir && shouldStoreLogs) {
    await mkdir(request.logsDir, { recursive: true });
  }

  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    let stdoutText = "";
    let stderrText = "";
    let settled = false;
    const stdoutLog = stdoutLogPath ? createWriteStream(stdoutLogPath, { flags: "w" }) : undefined;
    const stderrLog = stderrLogPath ? createWriteStream(stderrLogPath, { flags: "w" }) : undefined;

    const finish = async (result: Omit<CodexRunResult, "durationMs" | "reportPath" | "phaseId">) => {
      if (settled) {
        return;
      }
      settled = true;
      stdoutLog?.end();
      stderrLog?.end();
      resolve({
        phaseId: request.phaseId,
        reportPath: request.reportPath,
        durationMs: Date.now() - startedAt,
        stdoutLogPath,
        stderrLogPath,
        ...result
      });
    };

    try {
      child = spawnAdapter("codex", args, {
        cwd: request.projectRoot,
        env: process.env,
        stdio: "pipe"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void writeCodexFailureReport(request, `Codex could not be started: ${message}`, undefined, undefined).then(() => {
        void finish({ success: false, error: message });
      });
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLog?.write(chunk);
      stdoutText = appendBounded(stdoutText, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrLog?.write(chunk);
      stderrText = appendBounded(stderrText, chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      const message = error.message;
      void writeCodexFailureReport(request, `Codex could not be started: ${message}`, stdoutText, stderrText).then(() => {
        void finish({ success: false, error: message });
      });
    });

    child.on("close", (code) => {
      void (async () => {
        if (settled) {
          return;
        }

        if (code !== 0) {
          const message = classifyCodexError(stderrText, code);
          await writeCodexFailureReport(request, message, stdoutText, stderrText);
          await finish({ success: false, exitCode: code, error: message });
          return;
        }

        const hasReport = await hasUsableReport(request.reportPath);
        if (!hasReport) {
          const message = "Codex run succeeded but did not produce a usable final answer.";
          await writeCodexFailureReport(request, message, stdoutText, stderrText);
          await finish({ success: false, exitCode: code, error: message });
          return;
        }

        await finish({ success: true, exitCode: code });
      })();
    });

    child.stdin.write(request.prompt);
    child.stdin.end();
  });
}

async function hasUsableReport(reportPath: string): Promise<boolean> {
  try {
    const reportStat = await stat(reportPath);
    if (!reportStat.isFile() || reportStat.size === 0) {
      return false;
    }
    const content = await readFile(reportPath, "utf8");
    return content.trim().length > 0;
  } catch {
    return false;
  }
}

async function writeCodexFailureReport(
  request: CodexRunRequest,
  message: string,
  stdoutText: string | undefined,
  stderrText: string | undefined
): Promise<void> {
  const stdout = stdoutText?.trim();
  const stderr = stderrText?.trim();
  const body = `# ${request.phaseTitle}

## Status

Failed.

## Error

${message}

## Notes

- RepoVista did not modify the target code.
- Check whether Codex CLI is installed and authenticated.
- If the project is not a Git repository, RepoVista already uses \`--skip-git-repo-check\`.

${stderr ? `## Codex stderr\n\n\`\`\`text\n${truncate(stderr)}\n\`\`\`\n` : ""}
${stdout ? `## Codex stdout\n\n\`\`\`text\n${truncate(stdout)}\n\`\`\`\n` : ""}
`;
  await writeFile(request.reportPath, body, "utf8");
}

function classifyCodexError(stderrText: string, code: number | null): string {
  const lower = stderrText.toLowerCase();
  if (lower.includes("auth") || lower.includes("login") || lower.includes("api key")) {
    return "Codex CLI appears to be unauthenticated. Sign in to the Codex CLI and start RepoVista again.";
  }
  return `Codex run exited with code ${code ?? "unknown"}.`;
}

function appendBounded(current: string, addition: string): string {
  const next = current + addition;
  return next.length <= MAX_ERROR_TEXT ? next : next.slice(next.length - MAX_ERROR_TEXT);
}

function truncate(value: string): string {
  return value.length <= MAX_ERROR_TEXT ? value : `${value.slice(0, MAX_ERROR_TEXT)}\n... truncated ...`;
}
