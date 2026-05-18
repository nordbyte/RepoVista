import { spawn } from "node:child_process";
import type { DiffFileStatus, DiffScope } from "./types.js";

const DEFAULT_TIMEOUT_SECONDS = 10;

export async function collectDiffScope(
  projectRoot: string,
  ref: string,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS
): Promise<DiffScope> {
  const trimmed = ref.trim();
  if (!/^[A-Za-z0-9_./:@{}~^+-]+$/.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`Unsafe git ref for --since: ${ref}`);
  }

  const output = await runGit(projectRoot, ["diff", "--name-status", "--relative", `${trimmed}...HEAD`], timeoutSeconds);
  const fileStatuses = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseNameStatusLine)
    .filter((status): status is DiffFileStatus => Boolean(status))
    .sort((left, right) => left.path.localeCompare(right.path));
  const changedFiles = fileStatuses.map((status) => status.path);
  return {
    ref: trimmed,
    changedFiles,
    fileStatuses
  };
}

function parseNameStatusLine(line: string): DiffFileStatus | undefined {
  const parts = line.split(/\t+/);
  const rawStatus = parts[0] ?? "";
  const path = parts[parts.length - 1]?.trim();
  if (!path || path.includes("..") || path.startsWith("/")) {
    return undefined;
  }
  return {
    path,
    previousPath: parts.length > 2 ? parts[1] : undefined,
    status: mapStatus(rawStatus)
  };
}

function mapStatus(value: string): DiffFileStatus["status"] {
  const code = value[0];
  if (code === "A") {
    return "added";
  }
  if (code === "M") {
    return "modified";
  }
  if (code === "D") {
    return "deleted";
  }
  if (code === "R") {
    return "renamed";
  }
  if (code === "C") {
    return "copied";
  }
  return "unknown";
}

async function runGit(projectRoot: string, args: string[], timeoutSeconds: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`git ${args.join(" ")} timed out after ${timeoutSeconds} seconds.`));
    }, timeoutSeconds * 1000);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git ${args.join(" ")} exited with ${code}.`));
        return;
      }
      resolve(stdout);
    });
  });
}
