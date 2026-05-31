import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadReportRun, listReportRuns, type ReportRunListOptions, type ReportRunSummary } from "./report-browser.js";
import { validateReportRoot } from "./reports.js";

export interface ReportArtifact {
  fileName: string;
  filePath: string;
  size: number;
  content: string;
}

export const REPORT_ARTIFACT_FILES = [
  "index.md",
  "00-inventory.md",
  "01-architecture-report.md",
  "02-code-quality-report.md",
  "03-risk-and-bug-report.md",
  "04-feature-roadmap.md",
  "findings.json",
  "findings.jsonl",
  "findings.sarif",
  "features.json",
  "meta.json",
  "project-map.json",
  "prompt-manifest.json",
  "report.html",
  "report.json",
  "status.json",
  "structured-reports.json",
  "summary.json"
] as const;

export async function readReportRuns(
  projectRoot: string,
  outDir = ".repovista",
  options: ReportRunListOptions = {}
): Promise<ReportRunSummary[]> {
  return listReportRuns(projectRoot, outDir, options);
}

export async function readReportRun(
  projectRoot: string,
  runIdOrDirectory: string,
  outDir = ".repovista",
  options: ReportRunListOptions = {}
): Promise<ReportRunSummary | undefined> {
  const runDir = await resolveRunDirectory(projectRoot, outDir, runIdOrDirectory);
  return loadReportRun(runDir, path.basename(runDir), projectRoot, options);
}

export async function readReportArtifact(
  projectRoot: string,
  runIdOrDirectory: string,
  fileName: string,
  outDir = ".repovista"
): Promise<ReportArtifact> {
  const runDir = await resolveRunDirectory(projectRoot, outDir, runIdOrDirectory);
  const normalizedFileName = normalizeArtifactFileName(fileName);
  const filePath = path.join(runDir, normalizedFileName);
  assertInside(runDir, filePath, "Report artifact");
  const [content, info] = await Promise.all([
    readFile(filePath, "utf8"),
    stat(filePath)
  ]);
  if (!info.isFile()) {
    throw new Error(`Report artifact is not a file: ${normalizedFileName}`);
  }
  return {
    fileName: normalizedFileName,
    filePath,
    size: info.size,
    content
  };
}

async function resolveRunDirectory(projectRoot: string, outDir: string, runIdOrDirectory: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  const raw = runIdOrDirectory.trim();
  if (!raw) {
    throw new Error("Run id or directory is required.");
  }
  const runDir = path.isAbsolute(raw) ? path.resolve(raw) : path.join(outRoot, raw);
  assertInside(outRoot, runDir, "Report run");
  const info = await stat(runDir);
  if (!info.isDirectory()) {
    throw new Error(`Report run is not a directory: ${runDir}`);
  }
  return runDir;
}

function normalizeArtifactFileName(fileName: string): string {
  const normalized = fileName.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error(`Invalid report artifact file name: ${fileName}`);
  }
  return normalized;
}

function assertInside(baseDirectory: string, targetPath: string, label: string): void {
  const relative = path.relative(path.resolve(baseDirectory), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the report directory: ${targetPath}`);
  }
}
