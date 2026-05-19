import { mkdir, open, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import { validateReportRoot } from "./reports.js";
import { stableId } from "./stable-id.js";
import { readStateFile, writeStateFileAtomic } from "./state-store.js";
import type { FeatureLock, FeatureRecord, FeatureStatus, SemanticFeature, StructuredFinding } from "./types.js";

const FEATURE_STATE_VERSION = 1;

export async function featureStateDirectory(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "features");
}

export async function featureLocksDirectory(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "locks", "features");
}

export async function loadFeatureRecords(projectRoot: string, outDir: string): Promise<FeatureRecord[]> {
  const dir = await featureStateDirectory(projectRoot, outDir);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const records: FeatureRecord[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      const feature = await readStateFile<FeatureRecord>(filePath, {
        kind: "feature",
        currentVersion: FEATURE_STATE_VERSION,
        label: "feature state file",
        legacy: (value) => {
          const legacy = value as { version?: number; feature?: FeatureRecord };
          return legacy?.version === FEATURE_STATE_VERSION && legacy.feature?.featureId ? legacy.feature : undefined;
        }
      });
      records.push(feature);
    }
    return records.sort((left, right) => left.title.localeCompare(right.title));
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

export async function syncFeatureRecords(
  projectRoot: string,
  outDir: string,
  features: SemanticFeature[],
  runId: string,
  now = new Date()
): Promise<string> {
  const dir = await featureStateDirectory(projectRoot, outDir);
  await mkdir(dir, { recursive: true });
  const existing = new Map((await loadFeatureRecords(projectRoot, outDir)).map((feature) => [feature.featureId, feature]));
  const expected = new Set<string>();
  for (const feature of features) {
    const previous = existing.get(feature.id);
    const signature = featureSignature(feature);
    const changed = previous && previous.signature !== signature;
    const status: FeatureStatus = changed ? "pending" : previous?.status ?? "pending";
    const record: FeatureRecord = {
      ...feature,
      schemaVersion: 1,
      featureId: feature.id,
      status,
      signature,
      findingIds: previous?.findingIds ?? [],
      patchAttemptIds: previous?.patchAttemptIds ?? [],
      lock: previous?.lock ?? null,
      analysisHistory: appendFeatureHistory(previous?.analysisHistory, {
        runId,
        kind: "map",
        status,
        note: changed ? "Feature changed since previous map." : "Feature mapped by RepoVista.",
        createdAt: now.toISOString()
      }),
      createdAt: previous?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString()
    };
    const fileName = featureFileName(record.featureId);
    expected.add(fileName);
    await writeFeatureRecord(dir, record);
  }

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json") || expected.has(entry.name)) {
      return;
    }
    await unlink(path.join(dir, entry.name)).catch(() => undefined);
  }));
  return dir;
}

export async function assignFindingsToFeatures(
  features: SemanticFeature[],
  findings: StructuredFinding[]
): Promise<StructuredFinding[]> {
  return findings.map((finding) => ({
    ...finding,
    featureId: finding.featureId ?? bestFeatureForFinding(features, finding)?.id
  }));
}

export async function updateFeatureRecordsFromFindings(
  projectRoot: string,
  outDir: string,
  findings: StructuredFinding[],
  runId: string,
  now = new Date()
): Promise<void> {
  const dir = await featureStateDirectory(projectRoot, outDir);
  const findingsByFeature = new Map<string, string[]>();
  for (const finding of findings) {
    if (!finding.featureId) {
      continue;
    }
    const ids = findingsByFeature.get(finding.featureId) ?? [];
    ids.push(finding.id);
    findingsByFeature.set(finding.featureId, ids);
  }
  const records = await loadFeatureRecords(projectRoot, outDir);
  for (const record of records) {
    const findingIds = findingsByFeature.get(record.featureId) ?? [];
    const status: FeatureStatus = findingIds.length ? "needs-fix" : record.status === "claimed" ? "reviewed" : record.status;
    await writeFeatureRecord(dir, {
      ...record,
      status,
      findingIds: Array.from(new Set([...record.findingIds, ...findingIds])),
      updatedAt: now.toISOString(),
      analysisHistory: appendFeatureHistory(record.analysisHistory, {
        runId,
        kind: "audit",
        status,
        findingIds,
        note: findingIds.length ? "Audit linked findings to this feature." : "Audit completed without linked findings.",
        createdAt: now.toISOString()
      })
    });
  }
}

export async function claimFeature(
  projectRoot: string,
  outDir: string,
  featureId: string,
  lock: FeatureLock,
  options: { allowNonPending?: boolean } = {}
): Promise<FeatureRecord> {
  const locksDir = await featureLocksDirectory(projectRoot, outDir);
  await mkdir(locksDir, { recursive: true });
  const lockPath = path.join(locksDir, `${featureFileName(featureId)}.lock`);
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      throw new RepoVistaError(`Feature is already locked: ${featureId}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }

  try {
    const record = await readFeatureRecord(projectRoot, outDir, featureId);
    if (!record) {
      throw new RepoVistaError(`Feature not found: ${featureId}`);
    }
    if (!options.allowNonPending && !["pending", "error", "reviewed", "needs-fix"].includes(record.status)) {
      throw new RepoVistaError(`Feature is not reviewable: ${featureId}`);
    }
    const claimed: FeatureRecord = {
      ...record,
      status: "claimed",
      lock,
      updatedAt: lock.createdAt,
      analysisHistory: appendFeatureHistory(record.analysisHistory, {
        runId: lock.runId,
        kind: "claim",
        status: "claimed",
        createdAt: lock.createdAt
      })
    };
    await writeFeatureRecord(await featureStateDirectory(projectRoot, outDir), claimed);
    return claimed;
  } catch (error) {
    await releaseFeature(projectRoot, outDir, featureId);
    throw error;
  }
}

export async function releaseFeature(
  projectRoot: string,
  outDir: string,
  featureId: string,
  status?: FeatureStatus,
  note?: string,
  now = new Date()
): Promise<void> {
  const record = await readFeatureRecord(projectRoot, outDir, featureId);
  const locksDir = await featureLocksDirectory(projectRoot, outDir);
  await rm(path.join(locksDir, `${featureFileName(featureId)}.lock`), { force: true }).catch(() => undefined);
  if (!record) {
    return;
  }
  const nextStatus = status ?? (record.status === "claimed" ? "reviewed" : record.status);
  await writeFeatureRecord(await featureStateDirectory(projectRoot, outDir), {
    ...record,
    status: nextStatus,
    lock: null,
    updatedAt: now.toISOString(),
    analysisHistory: appendFeatureHistory(record.analysisHistory, {
      runId: record.lock?.runId,
      kind: nextStatus === "error" ? "error" : "review",
      status: nextStatus,
      note,
      createdAt: now.toISOString()
    })
  });
}

export async function cleanFeatureLocks(projectRoot: string, outDir: string, force = false): Promise<{ removed: number; kept: number }> {
  const locksDir = await featureLocksDirectory(projectRoot, outDir);
  let removed = 0;
  let kept = 0;
  const entries = await readdir(locksDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) {
      continue;
    }
    const filePath = path.join(locksDir, entry.name);
    const stale = force || await isStaleLock(filePath);
    if (stale) {
      await rm(filePath, { force: true });
      removed += 1;
    } else {
      kept += 1;
    }
  }
  const stateDir = await featureStateDirectory(projectRoot, outDir);
  for (const record of await loadFeatureRecords(projectRoot, outDir)) {
    const lockPath = path.join(locksDir, `${featureFileName(record.featureId)}.lock`);
    const lockExists = await stat(lockPath).then(() => true, () => false);
    if (record.lock && !lockExists) {
      await writeFeatureRecord(stateDir, {
        ...record,
        status: record.status === "claimed" ? "pending" : record.status,
        lock: null,
        updatedAt: new Date().toISOString()
      });
    }
  }
  return { removed, kept };
}

export async function runCleanLocksCommand(options: { outDir: string; force?: boolean }, projectRoot = process.cwd()): Promise<string> {
  const result = await cleanFeatureLocks(projectRoot, options.outDir, Boolean(options.force));
  return `Cleaned RepoVista feature locks: removed ${result.removed}, kept ${result.kept}.\n`;
}

async function readFeatureRecord(projectRoot: string, outDir: string, featureId: string): Promise<FeatureRecord | undefined> {
  const dir = await featureStateDirectory(projectRoot, outDir);
  try {
    return await readStateFile<FeatureRecord>(path.join(dir, featureFileName(featureId)), {
      kind: "feature",
      currentVersion: FEATURE_STATE_VERSION,
      label: "feature state file",
      legacy: (value) => {
        const legacy = value as { version?: number; feature?: FeatureRecord };
        return legacy?.version === FEATURE_STATE_VERSION && legacy.feature?.featureId ? legacy.feature : undefined;
      }
    });
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

async function writeFeatureRecord(dir: string, feature: FeatureRecord): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeStateFileAtomic(path.join(dir, featureFileName(feature.featureId)), {
    schemaVersion: FEATURE_STATE_VERSION,
    kind: "feature",
    data: feature
  });
}

function bestFeatureForFinding(features: SemanticFeature[], finding: StructuredFinding): SemanticFeature | undefined {
  const paths = finding.paths ?? [];
  return features
    .map((feature) => ({
      feature,
      score: paths.reduce((sum, findingPath) => sum + scoreFeaturePath(feature, findingPath), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.feature.ownedFiles.length - left.feature.ownedFiles.length)[0]?.feature;
}

function scoreFeaturePath(feature: SemanticFeature, filePath: string): number {
  if (feature.ownedFiles.includes(filePath)) {
    return 8;
  }
  if (feature.tests.includes(filePath)) {
    return 5;
  }
  if (feature.contextFiles.includes(filePath)) {
    return 3;
  }
  return feature.paths.some((featurePath) => filePath === featurePath || filePath.startsWith(`${featurePath.replace(/\/+$/g, "")}/`)) ? 1 : 0;
}

function featureSignature(feature: SemanticFeature): string {
  return stableId("fsig", [
    feature.title,
    feature.kind,
    feature.paths,
    feature.ownedFiles,
    feature.contextFiles,
    feature.tests,
    feature.tags,
    feature.trustBoundaries,
    feature.validationCommands
  ]);
}

function featureFileName(featureId: string): string {
  return `feat_${Buffer.from(featureId, "utf8").toString("base64url")}.json`;
}

function appendFeatureHistory(
  existing: FeatureRecord["analysisHistory"] | undefined,
  entry: FeatureRecord["analysisHistory"][number]
): FeatureRecord["analysisHistory"] {
  const history = existing ? [...existing] : [];
  const previous = history[history.length - 1];
  if (previous?.kind === entry.kind && previous.status === entry.status && previous.runId === entry.runId && previous.note === entry.note) {
    return history;
  }
  history.push(entry);
  return history.slice(-50);
}

async function isStaleLock(filePath: string): Promise<boolean> {
  try {
    const info = JSON.parse(await readFile(filePath, "utf8")) as Partial<FeatureLock>;
    if (typeof info.pid === "number") {
      try {
        process.kill(info.pid, 0);
        return false;
      } catch {
        return true;
      }
    }
    const fileStat = await stat(filePath);
    return Date.now() - fileStat.mtimeMs > 6 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error, "ENOENT");
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === code);
}
