import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateReportRoot } from "./reports.js";
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
      const parsed = JSON.parse(await readFile(path.join(stateDirectory, entry.name), "utf8")) as {
        version?: number;
        finding?: StructuredFinding;
      };
      if (parsed.version === FINDING_STATE_VERSION && parsed.finding?.id) {
        findings.push(parsed.finding);
      }
    }
    return findings.sort(compareFindingsForStorage);
  } catch {
    return [];
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
  const tempPath = path.join(stateDirectory, `.${safeFindingFileName(finding.id)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify({
    version: FINDING_STATE_VERSION,
    finding
  }, null, 2)}\n`, "utf8");
  await rename(tempPath, finalPath);
}

export function safeFindingFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
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
