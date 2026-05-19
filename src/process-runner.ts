import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { maskSensitiveText } from "./secrets.js";

export interface ProcessRunOptions {
  cwd?: string;
  timeoutMs?: number;
  shell?: boolean;
  env?: NodeJS.ProcessEnv;
  input?: string;
  stdoutLimit?: number;
  stderrLimit?: number;
  maskOutput?: boolean;
  detached?: boolean;
  stdio?: SpawnOptions["stdio"];
}

export interface ProcessRunResult {
  command: string;
  args: string[];
  renderedCommand: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const FORCE_KILL_DELAY_MS = 5000;

export async function runProcess(
  command: string,
  args: string[] = [],
  options: ProcessRunOptions = {}
): Promise<ProcessRunResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdoutLimit = options.stdoutLimit ?? DEFAULT_OUTPUT_LIMIT;
  const stderrLimit = options.stderrLimit ?? DEFAULT_OUTPUT_LIMIT;
  const detached = options.detached ?? Boolean(options.shell && process.platform !== "win32");
  const stdio = options.stdio ?? "pipe";

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let hardSettleTimer: NodeJS.Timeout | undefined;
    let child: ChildProcess;
    const finish = (result: Pick<ProcessRunResult, "exitCode" | "signal"> & { error?: string }) => {
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
      if (hardSettleTimer) {
        clearTimeout(hardSettleTimer);
      }
      const clean = (value: string) => options.maskOutput === false ? value : maskSensitiveText(value);
      resolve({
        command,
        args,
        renderedCommand: renderCommand(command, args),
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: clean(stdout),
        stderr: clean(stderr),
        error: result.error ? clean(result.error) : timedOut ? `Command timed out after ${Math.ceil(timeoutMs / 1000)} seconds.` : undefined
      });
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: options.shell ?? false,
        detached,
        stdio
      });
    } catch (error) {
      finish({ exitCode: null, signal: null, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalProcess(child, detached, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          const errors = signalProcess(child, detached, "SIGKILL");
          hardSettleTimer = setTimeout(() => {
            finish({
              exitCode: null,
              signal: "SIGKILL",
              error: errors.length ? `Command timed out and could not be killed cleanly: ${errors.join("; ")}` : undefined
            });
          }, 1000);
          hardSettleTimer.unref();
        }
      }, FORCE_KILL_DELAY_MS);
      forceKillTimer.unref();
    }, timeoutMs);
    timeoutTimer.unref();

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk.toString("utf8"), stdoutLimit);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk.toString("utf8"), stderrLimit);
      });
    }
    child.on("error", (error) => finish({ exitCode: null, signal: null, error: error.message }));
    child.on("close", (code, signal) => finish({ exitCode: code, signal: signal as NodeJS.Signals | null }));

    if (options.input !== undefined && child.stdin) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

export async function commandAvailable(command: string, args: string[] = ["--version"], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  const result = await runProcess(command, args, {
    timeoutMs,
    stdio: "ignore",
    stdoutLimit: 0,
    stderrLimit: 0
  });
  return result.exitCode === 0;
}

export function signalProcess(child: Pick<ChildProcess, "pid" | "kill">, processGroup: boolean, signal: NodeJS.Signals): string[] {
  const errors: string[] = [];
  if (processGroup && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return errors;
    } catch (error) {
      errors.push(`process group ${signal}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    child.kill(signal);
  } catch (error) {
    errors.push(`child ${signal}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return errors;
}

function appendBounded(current: string, addition: string, limit: number): string {
  if (limit <= 0) {
    return "";
  }
  const next = current + addition;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

function renderCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}
