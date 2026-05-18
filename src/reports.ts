import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditMeta, RunPaths } from "./types.js";

export async function prepareRunDirectory(
  projectRoot: string,
  outDir: string,
  runId: string,
  createLogs: boolean
): Promise<RunPaths> {
  const outRoot = path.resolve(projectRoot, outDir);
  await mkdir(outRoot, { recursive: true });

  let candidateRunId = runId;
  let runDir = path.join(outRoot, candidateRunId);
  let suffix = 2;
  while (await pathExists(runDir)) {
    candidateRunId = `${runId}-${suffix}`;
    runDir = path.join(outRoot, candidateRunId);
    suffix += 1;
  }

  await mkdir(runDir, { recursive: false });

  const logsDir = createLogs ? path.join(runDir, "logs") : undefined;
  if (logsDir) {
    await mkdir(logsDir, { recursive: true });
  }

  return {
    outRoot,
    runDir,
    runId: candidateRunId,
    logsDir
  };
}

export async function useExistingRunDirectory(
  projectRoot: string,
  runDirectory: string,
  createLogs: boolean
): Promise<RunPaths> {
  const runDir = path.resolve(projectRoot, runDirectory);
  const runStat = await stat(runDir);
  if (!runStat.isDirectory()) {
    throw new Error(`Resume path is not a directory: ${runDir}`);
  }

  const logsDir = createLogs ? path.join(runDir, "logs") : undefined;
  if (logsDir) {
    await mkdir(logsDir, { recursive: true });
  }

  return {
    outRoot: path.dirname(runDir),
    runDir,
    runId: path.basename(runDir),
    logsDir
  };
}

export async function writeMarkdownReport(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, ensureTrailingNewline(content), "utf8");
}

export async function readReport(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeMeta(runDir: string, meta: AuditMeta): Promise<string> {
  const filePath = path.join(runDir, "meta.json");
  await writeJsonFile(filePath, meta);
  return filePath;
}

export function reportPath(runDir: string, fileName: string): string {
  return path.join(runDir, fileName);
}

export function relativeReportLink(fromFile: string, toFile: string): string {
  return path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
