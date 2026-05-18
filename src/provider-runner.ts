import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { getReportProvider } from "./providers/index.js";
import { maskSensitiveText } from "./secrets.js";
import type { ProviderRunRequest, ProviderRunResult } from "./types.js";

export type SpawnAdapter = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

const MAX_ERROR_TEXT = 8000;

export async function runProviderPhase(
  request: ProviderRunRequest,
  spawnAdapter: SpawnAdapter = spawn
): Promise<ProviderRunResult> {
  const startedAt = Date.now();
  const provider = getReportProvider(request.provider);
  const args = provider.buildArgs(request);
  const shouldStoreLogs = request.keepLogs || request.jsonEvents;
  const stdoutLogPath = shouldStoreLogs && request.logsDir
    ? path.join(request.logsDir, `${request.phaseId}.stdout${provider.stdoutLogExtension(request)}`)
    : undefined;
  const stderrLogPath = shouldStoreLogs && request.logsDir
    ? path.join(request.logsDir, `${request.phaseId}.stderr.log`)
    : undefined;

  if (request.logsDir && shouldStoreLogs) {
    await mkdir(request.logsDir, { recursive: true });
  }

  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams | undefined;
    let stdoutText = "";
    let stdoutOutput = "";
    let stderrText = "";
    let settled = false;
    let timedOut = false;
    let interrupted = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    const stdoutLog = stdoutLogPath ? createWriteStream(stdoutLogPath, { flags: "w" }) : undefined;
    const stderrLog = stderrLogPath ? createWriteStream(stderrLogPath, { flags: "w" }) : undefined;

    const finish = async (result: Omit<ProviderRunResult, "durationMs" | "reportPath" | "phaseId">) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      process.off("SIGINT", interruptHandler);
      process.off("SIGTERM", interruptHandler);
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

    const terminateChild = (reason: "timeout" | "interrupt") => {
      if (settled || !child) {
        return;
      }
      if (reason === "timeout") {
        timedOut = true;
      } else {
        interrupted = true;
      }
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          child?.kill("SIGKILL");
        }
      }, 5000);
      forceKillTimer.unref();
    };

    const interruptHandler = () => terminateChild("interrupt");

    try {
      child = spawnAdapter(provider.executable, args, {
        cwd: request.projectRoot,
        env: process.env,
        stdio: "pipe"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void writeProviderFailureReport(request, `Could not start ${provider.displayName}: ${message}`, undefined, undefined)
        .then(() => finish({ success: false, error: maskSensitiveText(message) }))
        .catch(() => finish({ success: false, error: maskSensitiveText(message) }));
      return;
    }

    process.once("SIGINT", interruptHandler);
    process.once("SIGTERM", interruptHandler);

    if (request.timeoutSeconds > 0) {
      timeoutTimer = setTimeout(() => terminateChild("timeout"), request.timeoutSeconds * 1000);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdoutLog?.write(maskSensitiveText(text));
      if (provider.outputMode === "stdout") {
        stdoutOutput += text;
      }
      stdoutText = appendBounded(stdoutText, text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrLog?.write(maskSensitiveText(text));
      stderrText = appendBounded(stderrText, text);
    });

    child.on("error", (error) => {
      const message = error.message;
      void writeProviderFailureReport(request, `Could not start ${provider.displayName}: ${message}`, stdoutText, stderrText)
        .then(() => finish({ success: false, error: maskSensitiveText(message) }))
        .catch(() => finish({ success: false, error: maskSensitiveText(message) }));
    });

    child.on("close", (code, signal) => {
      void (async () => {
        if (settled) {
          return;
        }

        if (timedOut || interrupted) {
          const message = timedOut
            ? `${provider.displayName} run timed out after ${request.timeoutSeconds} seconds.`
            : `${provider.displayName} run was interrupted and cancelled.`;
          await writeProviderFailureReport(request, message, stdoutText, stderrText);
          await finish({ success: false, exitCode: code, error: signal ? `${message} Signal: ${signal}.` : message });
          return;
        }

        if (code !== 0) {
          const message = provider.classifyError(stderrText, code);
          await writeProviderFailureReport(request, message, stdoutText, stderrText);
          await finish({ success: false, exitCode: code, error: message });
          return;
        }

        if (provider.outputMode === "stdout") {
          const report = stdoutOutput.trim();
          if (report) {
            await writeFile(request.reportPath, `${report}\n`, "utf8");
          }
        }

        const hasReport = await hasUsableReport(request.reportPath);
        if (!hasReport) {
          const message = `${provider.displayName} run succeeded but did not produce a usable final answer.`;
          await writeProviderFailureReport(request, message, stdoutText, stderrText);
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

async function writeProviderFailureReport(
  request: ProviderRunRequest,
  message: string,
  stdoutText: string | undefined,
  stderrText: string | undefined
): Promise<void> {
  const provider = getReportProvider(request.provider);
  const maskedMessage = maskSensitiveText(message);
  const stdout = stdoutText ? maskSensitiveText(stdoutText).trim() : undefined;
  const stderr = stderrText ? maskSensitiveText(stderrText).trim() : undefined;
  const body = `# ${request.phaseTitle}

## Status

Failed.

## Error

${maskedMessage}

## Notes

- RepoVista did not modify the target code.
- Selected provider: ${provider.displayName} (\`${provider.executable}\`).
- Check whether ${provider.displayName} is installed and authenticated.

${stderr ? `## ${provider.displayName} stderr\n\n\`\`\`text\n${truncate(stderr)}\n\`\`\`\n` : ""}
${stdout ? `## ${provider.displayName} stdout\n\n\`\`\`text\n${truncate(stdout)}\n\`\`\`\n` : ""}
`;
  await writeFile(request.reportPath, body, "utf8");
}

function appendBounded(current: string, addition: string): string {
  const next = current + addition;
  return next.length <= MAX_ERROR_TEXT ? next : next.slice(next.length - MAX_ERROR_TEXT);
}

function truncate(value: string): string {
  return value.length <= MAX_ERROR_TEXT ? value : `${value.slice(0, MAX_ERROR_TEXT)}\n... truncated ...`;
}
