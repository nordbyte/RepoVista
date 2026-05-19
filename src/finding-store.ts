import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import { validateReportRoot } from "./reports.js";
import { readStateFile, writeStateFileAtomic } from "./state-store.js";
import type { StructuredFinding } from "./types.js";

export const FINDING_STATE_VERSION = 1;

export async function findingStateDirectory(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "findings");
}

export async function loadStoredFindings(projectRoot: string, outDir: string): Promise<StructuredFinding[]> {
  const stateDirectory = await findingStateDirectory(projectRoot, outDir);
  try {
    const entries = await readdir(stateDirectory, { withFileTypes: true });
    const findings: StructuredFinding[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(stateDirectory, entry.name);
      const parsed = await readFindingStateFile(filePath);
      if (parsed.version === FINDING_STATE_VERSION && parsed.finding?.id) {
        findings.push(parsed.finding);
      } else {
        throw new RepoVistaError(`Invalid RepoVista finding state file: ${filePath}`);
      }
    }
    return findings.sort(compareFindingsForStorage);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

export async function rewriteFindingStateAtomic(
  projectRoot: string,
  outDir: string,
  findings: StructuredFinding[]
): Promise<void> {
  const stateDirectory = await findingStateDirectory(projectRoot, outDir);
  await mkdir(stateDirectory, { recursive: true });
  const expectedFiles = new Set<string>();

  for (const finding of findings) {
    const fileName = `${safeFindingFileName(finding.id)}.json`;
    expectedFiles.add(fileName);
    await writeFindingFileAtomic(stateDirectory, finding);
  }

  const entries = await readdir(stateDirectory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json") || expectedFiles.has(entry.name)) {
      return;
    }
    try {
      await unlink(path.join(stateDirectory, entry.name));
    } catch {
      // Best-effort cleanup; stale files are ignored by later rewrites.
    }
  }));
}

export async function writeFindingFileAtomic(stateDirectory: string, finding: StructuredFinding): Promise<void> {
  await mkdir(stateDirectory, { recursive: true });
  const finalPath = path.join(stateDirectory, `${safeFindingFileName(finding.id)}.json`);
  await writeStateFileAtomic(finalPath, {
    schemaVersion: FINDING_STATE_VERSION,
    kind: "finding",
    data: finding
  });
}

export function safeFindingFileName(value: string): string {
  return `f_${Buffer.from(value, "utf8").toString("base64url")}`;
}

async function readFindingStateFile(filePath: string): Promise<{ version?: number; finding?: StructuredFinding }> {
  const finding = await readStateFile<StructuredFinding>(filePath, {
    kind: "finding",
    currentVersion: FINDING_STATE_VERSION,
    label: "finding state file",
    legacy: (value) => {
      const legacy = value as { version?: number; finding?: StructuredFinding };
      return legacy?.version === FINDING_STATE_VERSION && legacy.finding?.id ? legacy.finding : undefined;
    }
  });
  return { version: FINDING_STATE_VERSION, finding };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function compareFindingsForStorage(left: StructuredFinding, right: StructuredFinding): number {
  return severityRank(right.severity) - severityRank(left.severity) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id);
}

function severityRank(value: StructuredFinding["severity"]): number {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    unknown: 0
  }[value] ?? 0;
}
