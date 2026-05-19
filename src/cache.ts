import { createHash } from "node:crypto";
import path from "node:path";
import { validateReportRoot } from "./reports.js";
import { readStateFile, writeStateFileAtomic } from "./state-store.js";
import type { AuditCacheMeta, ProjectFileSummary } from "./types.js";

interface ScanCacheFile {
  schemaVersion: 2;
  updatedAt: string;
  scanFingerprint: string;
  reuseKey: string;
  promptManifestFingerprint: string;
  providerVersion?: string;
  promptContextVersion: number;
  phaseSchemaVersion: number;
  qualityGateVersion: number;
  runDir: string;
  runId: string;
  fileCount: number;
}

export function projectScanFingerprint(files: ProjectFileSummary[], context?: unknown): string {
  const hash = createHash("sha256");
  if (context !== undefined) {
    hash.update(JSON.stringify(context));
    hash.update("\0");
  }
  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(file.sha256 ?? String(file.mtimeMs ?? ""));
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
  reuseKey: string;
  promptManifestFingerprint: string;
  providerVersion?: string;
  promptContextVersion: number;
  phaseSchemaVersion: number;
  qualityGateVersion: number;
  fileCount: number;
  enabled: boolean;
  now: Date;
}): Promise<AuditCacheMeta> {
  const cachePath = await scanCachePath(input.projectRoot, input.outDir);
  const previous = await readScanCache(cachePath);
  const mismatchReasons = cacheMismatchReasons(previous, input);
  const hit = Boolean(input.enabled && previous && mismatchReasons.length === 0);
  const meta: AuditCacheMeta = {
    enabled: input.enabled,
    cachePath,
    scanFingerprint: input.scanFingerprint,
    reuseKey: input.reuseKey,
    promptManifestFingerprint: input.promptManifestFingerprint,
    providerVersion: input.providerVersion,
    promptContextVersion: input.promptContextVersion,
    phaseSchemaVersion: input.phaseSchemaVersion,
    qualityGateVersion: input.qualityGateVersion,
    hit,
    previousRunDir: hit ? previous?.runDir : undefined,
    previousRunId: hit ? previous?.runId : undefined,
    mismatchReasons: input.enabled && !hit ? mismatchReasons : [],
    updatedAt: input.now.toISOString()
  };
  await writeStateFileAtomic(cachePath, {
    schemaVersion: 2,
    kind: "cache",
    data: {
      schemaVersion: 2,
      updatedAt: input.now.toISOString(),
      scanFingerprint: input.scanFingerprint,
      reuseKey: input.reuseKey,
      promptManifestFingerprint: input.promptManifestFingerprint,
      providerVersion: input.providerVersion,
      promptContextVersion: input.promptContextVersion,
      phaseSchemaVersion: input.phaseSchemaVersion,
      qualityGateVersion: input.qualityGateVersion,
      runDir: input.runDir,
      runId: input.runId,
      fileCount: input.fileCount
    } satisfies ScanCacheFile
  });
  return meta;
}

async function scanCachePath(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "cache", "project-scan.json");
}

async function readScanCache(cachePath: string): Promise<ScanCacheFile | undefined> {
  try {
    return await readStateFile<ScanCacheFile>(cachePath, {
      kind: "cache",
      currentVersion: 2,
      label: "cache file",
      legacy: (value) => {
        const parsed = value as Partial<ScanCacheFile> & { schemaVersion?: number };
        return parsed.schemaVersion === 2 && typeof parsed.scanFingerprint === "string" && typeof parsed.reuseKey === "string"
          ? parsed as ScanCacheFile
          : undefined;
      }
    });
  } catch {
    return undefined;
  }
}

function cacheMismatchReasons(previous: ScanCacheFile | undefined, input: {
  scanFingerprint: string;
  reuseKey: string;
  promptManifestFingerprint: string;
  providerVersion?: string;
  promptContextVersion: number;
  phaseSchemaVersion: number;
  qualityGateVersion: number;
}): string[] {
  if (!previous) {
    return ["no compatible cache entry"];
  }
  const reasons: string[] = [];
  if (previous.scanFingerprint !== input.scanFingerprint) {
    reasons.push("file hashes changed");
  }
  if (previous.reuseKey !== input.reuseKey) {
    reasons.push("audit context changed");
  }
  if (previous.promptManifestFingerprint !== input.promptManifestFingerprint) {
    reasons.push("prompt manifest inputs changed");
  }
  if ((previous.providerVersion ?? "") !== (input.providerVersion ?? "")) {
    reasons.push("provider version changed");
  }
  if (previous.promptContextVersion !== input.promptContextVersion) {
    reasons.push("prompt context version changed");
  }
  if (previous.phaseSchemaVersion !== input.phaseSchemaVersion) {
    reasons.push("phase schema version changed");
  }
  if (previous.qualityGateVersion !== input.qualityGateVersion) {
    reasons.push("quality gate version changed");
  }
  return reasons;
}
