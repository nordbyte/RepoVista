import { createHash } from "node:crypto";
import path from "node:path";
import { validateReportRoot } from "./reports.js";
import { readStateFile, writeStateFileAtomic } from "./state-store.js";
import type { AuditCacheMeta, FeatureCacheReuse, PhaseCacheReuse, ProjectFileSummary, ShardCacheReuse } from "./types.js";

interface ScanCacheFile {
  schemaVersion: 3;
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
  phaseFingerprints?: PhaseCacheEntry[];
  featureFingerprints?: FeatureCacheEntry[];
  shardFingerprints?: ShardCacheEntry[];
}

export interface PhaseCacheEntry {
  phaseId: string;
  reportFile: string;
  fingerprint: string;
}

export interface FeatureCacheEntry {
  featureId: string;
  fingerprint: string;
}

export interface ShardCacheEntry {
  phaseId: string;
  shardId: string;
  reportFile: string;
  fingerprint: string;
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
  phaseFingerprints?: PhaseCacheEntry[];
  featureFingerprints?: FeatureCacheEntry[];
  shardFingerprints?: ShardCacheEntry[];
  enabled: boolean;
  now: Date;
}): Promise<AuditCacheMeta> {
  const cachePath = await scanCachePath(input.projectRoot, input.outDir);
  const previous = await readScanCache(cachePath);
  const mismatchReasons = cacheMismatchReasons(previous, input);
  const hit = Boolean(input.enabled && previous && mismatchReasons.length === 0);
  const phaseReuse = phaseReuseEntries(previous, input);
  const featureReuse = featureReuseEntries(previous, input);
  const shardReuse = shardReuseEntries(previous, input);
  const meta: AuditCacheMeta = {
    enabled: input.enabled,
    cachePath,
    schemaVersion: 3,
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
    phaseReuse: input.enabled ? phaseReuse : [],
    featureReuse: input.enabled ? featureReuse : [],
    shardReuse: input.enabled ? shardReuse : [],
    updatedAt: input.now.toISOString()
  };
  await writeStateFileAtomic(cachePath, {
    schemaVersion: 3,
    kind: "cache",
    data: {
      schemaVersion: 3,
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
      fileCount: input.fileCount,
      phaseFingerprints: input.phaseFingerprints ?? [],
      featureFingerprints: input.featureFingerprints ?? [],
      shardFingerprints: input.shardFingerprints ?? []
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
      currentVersion: 3,
      label: "cache file",
      migrate: (value, fromVersion) => {
        if (fromVersion !== 2) {
          return undefined;
        }
        const parsed = value as Partial<Omit<ScanCacheFile, "schemaVersion">> & { schemaVersion?: number };
        return typeof parsed.scanFingerprint === "string" && typeof parsed.reuseKey === "string"
          ? {
              ...parsed,
              schemaVersion: 3,
              phaseFingerprints: parsed.phaseFingerprints ?? [],
              featureFingerprints: parsed.featureFingerprints ?? [],
              shardFingerprints: parsed.shardFingerprints ?? []
            } as ScanCacheFile
          : undefined;
      },
      legacy: (value) => {
        const parsed = value as Partial<Omit<ScanCacheFile, "schemaVersion">> & { schemaVersion?: number };
        if ((parsed.schemaVersion === 2 || parsed.schemaVersion === 3) && typeof parsed.scanFingerprint === "string" && typeof parsed.reuseKey === "string") {
          return {
            ...parsed,
            schemaVersion: 3,
            phaseFingerprints: parsed.phaseFingerprints ?? [],
            featureFingerprints: parsed.featureFingerprints ?? [],
            shardFingerprints: parsed.shardFingerprints ?? []
          } as ScanCacheFile;
        }
        return undefined;
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

function phaseReuseEntries(previous: ScanCacheFile | undefined, input: {
  phaseFingerprints?: PhaseCacheEntry[];
  promptManifestFingerprint: string;
  providerVersion?: string;
  promptContextVersion: number;
  phaseSchemaVersion: number;
  qualityGateVersion: number;
}): PhaseCacheReuse[] {
  const previousByPhase = new Map((previous?.phaseFingerprints ?? []).map((entry) => [entry.phaseId, entry]));
  const compatibility = compatibilityMismatchReasons(previous, input);
  return (input.phaseFingerprints ?? []).map((entry) => {
    const old = previousByPhase.get(entry.phaseId);
    const mismatchReasons = [
      ...compatibility,
      ...(!old ? ["no previous phase fingerprint"] : []),
      ...(old && old.fingerprint !== entry.fingerprint ? ["phase input files changed"] : []),
      ...(old && old.reportFile !== entry.reportFile ? ["phase report target changed"] : [])
    ];
    return {
      phaseId: entry.phaseId,
      reportFile: entry.reportFile,
      fingerprint: entry.fingerprint,
      hit: Boolean(previous && old && mismatchReasons.length === 0),
      previousRunDir: previous && old && mismatchReasons.length === 0 ? previous.runDir : undefined,
      previousRunId: previous && old && mismatchReasons.length === 0 ? previous.runId : undefined,
      mismatchReasons
    };
  });
}

function featureReuseEntries(previous: ScanCacheFile | undefined, input: {
  featureFingerprints?: FeatureCacheEntry[];
  promptContextVersion: number;
  phaseSchemaVersion: number;
  qualityGateVersion: number;
}): FeatureCacheReuse[] {
  const previousByFeature = new Map((previous?.featureFingerprints ?? []).map((entry) => [entry.featureId, entry]));
  const compatibility = compatibilityMismatchReasons(previous, input);
  return (input.featureFingerprints ?? []).map((entry) => {
    const old = previousByFeature.get(entry.featureId);
    const mismatchReasons = [
      ...compatibility,
      ...(!old ? ["no previous feature fingerprint"] : []),
      ...(old && old.fingerprint !== entry.fingerprint ? ["feature input files changed"] : [])
    ];
    return {
      featureId: entry.featureId,
      fingerprint: entry.fingerprint,
      hit: Boolean(previous && old && mismatchReasons.length === 0),
      previousRunId: previous && old && mismatchReasons.length === 0 ? previous.runId : undefined,
      mismatchReasons
    };
  });
}

function shardReuseEntries(previous: ScanCacheFile | undefined, input: {
  shardFingerprints?: ShardCacheEntry[];
  promptManifestFingerprint: string;
  providerVersion?: string;
  promptContextVersion: number;
  phaseSchemaVersion: number;
  qualityGateVersion: number;
}): ShardCacheReuse[] {
  const previousByShard = new Map((previous?.shardFingerprints ?? []).map((entry) => [`${entry.phaseId}:${entry.shardId}`, entry]));
  const compatibility = compatibilityMismatchReasons(previous, input);
  return (input.shardFingerprints ?? []).map((entry) => {
    const key = `${entry.phaseId}:${entry.shardId}`;
    const old = previousByShard.get(key);
    const mismatchReasons = [
      ...compatibility,
      ...(!old ? ["no previous shard fingerprint"] : []),
      ...(old && old.fingerprint !== entry.fingerprint ? ["shard input files changed"] : []),
      ...(old && old.reportFile !== entry.reportFile ? ["shard report target changed"] : [])
    ];
    return {
      phaseId: entry.phaseId,
      shardId: entry.shardId,
      reportFile: entry.reportFile,
      fingerprint: entry.fingerprint,
      hit: Boolean(previous && old && mismatchReasons.length === 0),
      previousRunDir: previous && old && mismatchReasons.length === 0 ? previous.runDir : undefined,
      previousRunId: previous && old && mismatchReasons.length === 0 ? previous.runId : undefined,
      mismatchReasons
    };
  });
}

function compatibilityMismatchReasons(previous: ScanCacheFile | undefined, input: {
  promptManifestFingerprint?: string;
  providerVersion?: string;
  promptContextVersion: number;
  phaseSchemaVersion: number;
  qualityGateVersion: number;
}): string[] {
  if (!previous) {
    return ["no compatible cache entry"];
  }
  const reasons: string[] = [];
  if (input.promptManifestFingerprint !== undefined && previous.promptManifestFingerprint !== input.promptManifestFingerprint) {
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
