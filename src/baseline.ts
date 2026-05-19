import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import { findingStateDirectory, loadStoredFindings } from "./finding-store.js";
import { findingCountsBySeverity } from "./findings.js";
import { validateReportRoot } from "./reports.js";
import type { AuditOptions, StructuredFinding } from "./types.js";

export interface BaselineSuppression {
  id?: string;
  signature?: string;
  title?: string;
  severity?: StructuredFinding["severity"];
  reason?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenRunId?: string;
}

export interface BaselineFile {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  suppressions: BaselineSuppression[];
}

export interface BaselineApplyResult {
  activeFindings: StructuredFinding[];
  suppressedFindings: StructuredFinding[];
  baselinePath: string;
}

export async function runBaselineCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const action = options.baselineAction ?? "list";
  if (action === "list") {
    const baseline = await loadBaseline(projectRoot, options.outDir, now);
    if (options.json) {
      return `${JSON.stringify(baseline.file, null, 2)}\n`;
    }
    if (!baseline.file.suppressions.length) {
      return `No RepoVista baseline suppressions found at ${baseline.path}.\n`;
    }
    return `RepoVista baseline suppressions at ${baseline.path}:\n${baseline.file.suppressions.map((item) => [
      `- ${item.id ?? item.signature ?? item.title ?? "unknown"}`,
      item.severity ? `  severity: ${item.severity}` : undefined,
      item.reason ? `  reason: ${item.reason}` : undefined,
      item.lastSeenRunId ? `  last seen: ${item.lastSeenRunId}` : undefined
    ].filter(Boolean).join("\n")).join("\n")}\n`;
  }

  if (action === "prune") {
    const baseline = await loadBaseline(projectRoot, options.outDir, now);
    const findings = await loadStoredFindings(projectRoot, options.outDir);
    const activeKeys = new Set(findings.flatMap((finding) => baselineKeys(finding)));
    const kept = baseline.file.suppressions.filter((item) => suppressionKeys(item).some((key) => activeKeys.has(key)));
    const removed = baseline.file.suppressions.length - kept.length;
    await saveBaseline(projectRoot, options.outDir, {
      ...baseline.file,
      updatedAt: now.toISOString(),
      suppressions: kept
    });
    return `Pruned ${removed} stale RepoVista baseline suppression(s).\n`;
  }

  const findingId = requireFindingId(options);
  if (action === "remove") {
    const baseline = await loadBaseline(projectRoot, options.outDir, now);
    const next = baseline.file.suppressions.filter((item) => item.id !== findingId && item.signature !== findingId);
    if (next.length === baseline.file.suppressions.length) {
      throw new RepoVistaError(`Baseline suppression not found: ${findingId}`);
    }
    await saveBaseline(projectRoot, options.outDir, {
      ...baseline.file,
      updatedAt: now.toISOString(),
      suppressions: next
    });
    return `Removed RepoVista baseline suppression ${findingId}.\n`;
  }

  const finding = (await loadStoredFindings(projectRoot, options.outDir)).find((item) => item.id === findingId);
  if (!finding) {
    throw new RepoVistaError(`Finding not found in ${await findingStateDirectory(projectRoot, options.outDir)}: ${findingId}`);
  }
  const baseline = await loadBaseline(projectRoot, options.outDir, now);
  const existingIndex = baseline.file.suppressions.findIndex((item) => suppressionMatchesFinding(item, finding));
  const suppression: BaselineSuppression = {
    id: finding.id,
    signature: finding.signature,
    title: finding.title,
    severity: finding.severity,
    reason: options.note,
    createdAt: existingIndex >= 0 ? baseline.file.suppressions[existingIndex].createdAt : now.toISOString(),
    updatedAt: now.toISOString(),
    lastSeenRunId: finding.lastSeenRunId
  };
  const suppressions = [...baseline.file.suppressions];
  if (existingIndex >= 0) {
    suppressions[existingIndex] = suppression;
  } else {
    suppressions.push(suppression);
  }
  await saveBaseline(projectRoot, options.outDir, {
    ...baseline.file,
    updatedAt: now.toISOString(),
    suppressions
  });
  return `Added RepoVista baseline suppression for ${finding.id}.\n`;
}

export async function applyBaselineToFindings(
  projectRoot: string,
  outDir: string,
  findings: StructuredFinding[],
  runId: string,
  now = new Date()
): Promise<BaselineApplyResult> {
  const baseline = await loadBaseline(projectRoot, outDir, now);
  const suppressedFindings: StructuredFinding[] = [];
  const activeFindings: StructuredFinding[] = [];
  let changed = false;

  for (const finding of findings) {
    const suppression = baseline.file.suppressions.find((item) => suppressionMatchesFinding(item, finding));
    if (!suppression) {
      activeFindings.push(finding);
      continue;
    }
    suppressedFindings.push({
      ...finding,
      status: "wont-fix",
      triage: "suppressed-by-baseline"
    });
    if (suppression.lastSeenRunId !== runId) {
      suppression.lastSeenRunId = runId;
      suppression.updatedAt = now.toISOString();
      changed = true;
    }
  }

  if (changed) {
    await saveBaseline(projectRoot, outDir, {
      ...baseline.file,
      updatedAt: now.toISOString()
    });
  }

  return {
    activeFindings,
    suppressedFindings,
    baselinePath: baseline.path
  };
}

export function baselineSummary(suppressedFindings: StructuredFinding[]): { count: number; counts: Record<string, number> } {
  return {
    count: suppressedFindings.length,
    counts: findingCountsBySeverity(suppressedFindings)
  };
}

async function loadBaseline(projectRoot: string, outDir: string, now: Date): Promise<{ path: string; file: BaselineFile }> {
  const baselinePath = await baselineFilePath(projectRoot, outDir);
  try {
    const parsed = JSON.parse(await readFile(baselinePath, "utf8")) as BaselineFile;
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.suppressions)) {
      return { path: baselinePath, file: parsed };
    }
    throw new RepoVistaError(`Invalid RepoVista baseline file: ${baselinePath}`);
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        path: baselinePath,
        file: {
          schemaVersion: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          suppressions: []
        }
      };
    }
    if (error instanceof RepoVistaError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoVistaError(`Could not read RepoVista baseline file ${baselinePath}: ${message}`);
  }
}

async function saveBaseline(projectRoot: string, outDir: string, baseline: BaselineFile): Promise<string> {
  const baselinePath = await baselineFilePath(projectRoot, outDir);
  await mkdir(path.dirname(baselinePath), { recursive: true });
  const tempPath = path.join(path.dirname(baselinePath), `.baseline.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  await rename(tempPath, baselinePath);
  return baselinePath;
}

async function baselineFilePath(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "baseline.json");
}

function suppressionMatchesFinding(suppression: BaselineSuppression, finding: StructuredFinding): boolean {
  const keys = new Set(baselineKeys(finding));
  return suppressionKeys(suppression).some((key) => keys.has(key));
}

function baselineKeys(finding: StructuredFinding): string[] {
  return [
    finding.id ? `id:${finding.id}` : undefined,
    finding.signature ? `sig:${finding.signature}` : undefined
  ].filter((item): item is string => Boolean(item));
}

function suppressionKeys(suppression: BaselineSuppression): string[] {
  return [
    suppression.id ? `id:${suppression.id}` : undefined,
    suppression.signature ? `sig:${suppression.signature}` : undefined
  ].filter((item): item is string => Boolean(item));
}

function requireFindingId(options: AuditOptions): string {
  if (!options.findingId) {
    throw new RepoVistaError("Baseline command requires a finding id.");
  }
  return options.findingId;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}
