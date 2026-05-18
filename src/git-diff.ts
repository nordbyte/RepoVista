import { spawn } from "node:child_process";
import type { DiffScope } from "./types.js";

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

  const output = await runGit(projectRoot, ["diff", "--name-only", "--relative", `${trimmed}...HEAD`], timeoutSeconds);
  const changedFiles = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("..") && !line.startsWith("/"))
    .sort();
  return {
    ref: trimmed,
    changedFiles
  };
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
