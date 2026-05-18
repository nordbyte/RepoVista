import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateReportRoot } from "./reports.js";
import type { AuditCacheMeta, ProjectFileSummary } from "./types.js";

interface ScanCacheFile {
  schemaVersion: 1;
  updatedAt: string;
  scanFingerprint: string;
  runDir: string;
  runId: string;
  fileCount: number;
}

export function projectScanFingerprint(files: ProjectFileSummary[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(file.sha256 ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function updateAuditCache(input: {
  projectRoot: string;
  outDir: string;
  runDir: string;
  runId: string;
  scanFingerprint: string;
  fileCount: number;
  enabled: boolean;
  now: Date;
}): Promise<AuditCacheMeta> {
  const cachePath = await scanCachePath(input.projectRoot, input.outDir);
  const previous = await readScanCache(cachePath);
  const hit = Boolean(input.enabled && previous?.scanFingerprint === input.scanFingerprint);
  const meta: AuditCacheMeta = {
    enabled: input.enabled,
    cachePath,
    scanFingerprint: input.scanFingerprint,
    hit,
    previousRunDir: hit ? previous?.runDir : undefined,
    previousRunId: hit ? previous?.runId : undefined,
    updatedAt: input.now.toISOString()
  };
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify({
    schemaVersion: 1,
    updatedAt: input.now.toISOString(),
    scanFingerprint: input.scanFingerprint,
    runDir: input.runDir,
    runId: input.runId,
    fileCount: input.fileCount
  } satisfies ScanCacheFile, null, 2)}\n`, "utf8");
  return meta;
}

async function scanCachePath(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "cache", "project-scan.json");
}

async function readScanCache(cachePath: string): Promise<ScanCacheFile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as ScanCacheFile;
    return parsed.schemaVersion === 1 && typeof parsed.scanFingerprint === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
