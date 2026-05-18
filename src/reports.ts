import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditMeta, RunPaths } from "./types.js";

const PROTECTED_TOP_LEVEL_PATHS = new Set([
  ".git",
  ".github",
  "app",
  "build",
  "coverage",
  "dist",
  "docs",
  "lib",
  "node_modules",
  "scripts",
  "src",
  "test",
  "tests"
]);

const RUN_MARKER_FILES = [
  "meta.json",
  "summary.json",
  "00-inventory.md"
];

export async function prepareRunDirectory(
  projectRoot: string,
  outDir: string,
  runId: string,
  createLogs: boolean
): Promise<RunPaths> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  await mkdir(outRoot, { recursive: true });
  await assertExistingPathInside(projectRoot, outRoot, "Report directory", "project root");

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
  createLogs: boolean,
  outDir = ".repovista"
): Promise<RunPaths> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  const runDir = path.resolve(projectRoot, runDirectory);
  assertNestedPath(outRoot, runDir, "Resume path", "report directory");
  await assertExistingPathInside(projectRoot, runDir, "Resume path", "project root");
  await assertExistingPathInside(outRoot, runDir, "Resume path", "report directory");

  const runStat = await stat(runDir);
  if (!runStat.isDirectory()) {
    throw new Error(`Resume path is not a directory: ${runDir}`);
  }
  await assertRepoVistaRunDirectory(runDir);

  const logsDir = createLogs ? path.join(runDir, "logs") : undefined;
  if (logsDir) {
    await mkdir(logsDir, { recursive: true });
  }

  return {
    outRoot,
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

export async function validateReportRoot(projectRoot: string, outDir: string): Promise<string> {
  const root = path.resolve(projectRoot);
  const outRoot = path.resolve(root, outDir);
  assertNestedPath(root, outRoot, "Report directory", "project root");
  assertNotProtectedProjectPath(root, outRoot);
  await assertExistingAncestorInside(root, outRoot, "Report directory", "project root");
  return outRoot;
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

function assertNestedPath(baseDirectory: string, targetPath: string, label: string, baseLabel: string): void {
  const relative = path.relative(path.resolve(baseDirectory), path.resolve(targetPath));
  if (!relative) {
    throw new Error(`${label} must not be identical to the ${baseLabel}.`);
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside the ${baseLabel}: ${targetPath}`);
  }
}

function assertNotProtectedProjectPath(projectRoot: string, outRoot: string): void {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(outRoot));
  const [firstSegment] = relative.split(path.sep).filter(Boolean);
  if (firstSegment && PROTECTED_TOP_LEVEL_PATHS.has(firstSegment)) {
    throw new Error(`Report directory must not be inside protected project path: ${firstSegment}`);
  }
}

async function assertExistingAncestorInside(
  baseDirectory: string,
  targetPath: string,
  label: string,
  baseLabel: string
): Promise<void> {
  const ancestor = await nearestExistingAncestor(targetPath);
  await assertExistingPathInside(baseDirectory, ancestor, label, baseLabel);
}

async function assertExistingPathInside(
  baseDirectory: string,
  targetPath: string,
  label: string,
  baseLabel: string
): Promise<void> {
  const [baseReal, targetReal] = await Promise.all([
    realpath(baseDirectory),
    realpath(targetPath)
  ]);
  const relative = path.relative(baseReal, targetReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the ${baseLabel}: ${targetPath}`);
  }
}

async function nearestExistingAncestor(targetPath: string): Promise<string> {
  let current = path.resolve(targetPath);
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}

async function assertRepoVistaRunDirectory(runDir: string): Promise<void> {
  for (const marker of RUN_MARKER_FILES) {
    try {
      const markerStat = await stat(path.join(runDir, marker));
      if (markerStat.isFile()) {
        return;
      }
    } catch {
      // Try the next marker.
    }
  }
  throw new Error(`Resume path does not look like a RepoVista run directory: expected ${RUN_MARKER_FILES.join(", ")}.`);
}
