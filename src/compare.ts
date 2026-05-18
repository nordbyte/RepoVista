import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import type { AuditMeta, StructuredFinding } from "./types.js";

export interface LoadedRun {
  runDir: string;
  runId: string;
  summary?: RunSummary;
  meta?: AuditMeta;
  findings: StructuredFinding[];
  reportMetrics: ReportMetric[];
}

export interface RunSummary {
  runId?: string;
  reportDir?: string;
  ai?: {
    provider?: string;
    displayName?: string;
    model?: string;
    reasoning?: string;
  };
  codex?: {
    model?: string;
    reasoning?: string;
  };
  findingCounts?: Record<string, number>;
  evidence?: {
    checks?: {
      enabled?: boolean;
      commands?: string[];
      failed?: boolean;
    };
  };
  phases?: Array<{
    id?: string;
    status?: string;
    qualityPassed?: boolean;
    qualityWarnings?: string[];
  }>;
}

export interface ReportMetric {
  fileName: string;
  lines: number;
  headings: number;
  pathEvidence: number;
}

type SummaryPhase = NonNullable<RunSummary["phases"]>[number];

const REPORT_FILES = [
  "01-architecture-report.md",
  "02-code-quality-report.md",
  "03-risk-and-bug-report.md",
  "04-feature-roadmap.md",
  "index.md"
];

export async function runCompareCommand(
  oldRunDirectory: string,
  newRunDirectory: string,
  projectRoot = process.cwd()
): Promise<string> {
  const oldRun = await loadRun(projectRoot, oldRunDirectory);
  const newRun = await loadRun(projectRoot, newRunDirectory);
  return renderRunComparison(oldRun, newRun);
}

export function renderRunComparison(oldRun: LoadedRun, newRun: LoadedRun): string {
  const diff = diffFindings(oldRun.findings, newRun.findings);
  const oldCounts = findingCounts(oldRun);
  const newCounts = findingCounts(newRun);

  return `# RepoVista Report Comparison

## Runs

| Signal | Old | New |
|---|---|---|
| Run ID | ${cell(oldRun.runId)} | ${cell(newRun.runId)} |
| Directory | \`${cell(oldRun.runDir)}\` | \`${cell(newRun.runDir)}\` |
| Provider | ${cell(displayProvider(oldRun))} | ${cell(displayProvider(newRun))} |
| Model | ${cell(displayModel(oldRun))} | ${cell(displayModel(newRun))} |
| Reasoning | ${cell(displayReasoning(oldRun))} | ${cell(displayReasoning(newRun))} |
| Checks | ${cell(displayChecks(oldRun))} | ${cell(displayChecks(newRun))} |

## Finding Counts

| Severity | Old | New | Delta |
|---|---:|---:|---:|
${["critical", "high", "medium", "low", "unknown"].map((severity) => {
    const oldValue = oldCounts[severity] ?? 0;
    const newValue = newCounts[severity] ?? 0;
    return `| ${severity} | ${oldValue} | ${newValue} | ${formatDelta(newValue - oldValue)} |`;
  }).join("\n")}

## Finding Changes

- Added: ${diff.added.length}
- Resolved: ${diff.resolved.length}
- Persisting: ${diff.persisting.length}

${renderFindingList("Added Findings", diff.added)}

${renderFindingList("Resolved Findings", diff.resolved)}

${renderFindingList("Persisting Findings", diff.persisting)}

## Report Depth

| Report | Old lines | New lines | Line delta | Old headings | New headings | Old path refs | New path refs |
|---|---:|---:|---:|---:|---:|---:|---:|
${REPORT_FILES.map((fileName) => renderMetricRow(fileName, oldRun.reportMetrics, newRun.reportMetrics)).join("\n")}

## Phase Quality

| Phase | Old | New |
|---|---|---|
${renderPhaseRows(oldRun, newRun)}
`;
}

async function loadRun(projectRoot: string, inputDirectory: string): Promise<LoadedRun> {
  const runDir = path.resolve(projectRoot, inputDirectory);
  await assertDirectory(runDir);
  const [summary, meta, findingsJson, reportMetrics] = await Promise.all([
    readJsonFile<RunSummary>(path.join(runDir, "summary.json")),
    readJsonFile<AuditMeta>(path.join(runDir, "meta.json")),
    readJsonFile<StructuredFinding[]>(path.join(runDir, "findings.json")),
    loadReportMetrics(runDir)
  ]);
  if (!summary && !meta && !Array.isArray(findingsJson)) {
    throw new RepoVistaError(`Compare path does not look like a RepoVista run directory: ${runDir}`);
  }
  return {
    runDir,
    runId: summary?.runId ?? meta?.runId ?? path.basename(runDir),
    summary,
    meta,
    findings: Array.isArray(findingsJson) ? findingsJson : [],
    reportMetrics
  };
}

async function assertDirectory(directory: string): Promise<void> {
  try {
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory()) {
      throw new RepoVistaError(`Compare path is not a directory: ${directory}`);
    }
  } catch (error) {
    if (error instanceof RepoVistaError) {
      throw error;
    }
    throw new RepoVistaError(`Compare path is not readable: ${directory}`);
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function loadReportMetrics(runDir: string): Promise<ReportMetric[]> {
  return Promise.all(REPORT_FILES.map(async (fileName) => {
    try {
      const content = await readFile(path.join(runDir, fileName), "utf8");
      return {
        fileName,
        lines: content.split(/\r?\n/).filter((line) => line.length > 0).length,
        headings: (content.match(/^#{1,6}\s+\S.+$/gm) ?? []).length,
        pathEvidence: countPathEvidence(content)
      };
    } catch {
      return {
        fileName,
        lines: 0,
        headings: 0,
        pathEvidence: 0
      };
    }
  }));
}

function diffFindings(oldFindings: StructuredFinding[], newFindings: StructuredFinding[]): {
  added: StructuredFinding[];
  resolved: StructuredFinding[];
  persisting: StructuredFinding[];
} {
  const oldByKey = new Map(oldFindings.map((finding) => [findingKey(finding), finding]));
  const newByKey = new Map(newFindings.map((finding) => [findingKey(finding), finding]));
  return {
    added: newFindings.filter((finding) => !oldByKey.has(findingKey(finding))),
    resolved: oldFindings.filter((finding) => !newByKey.has(findingKey(finding))),
    persisting: newFindings.filter((finding) => oldByKey.has(findingKey(finding)))
  };
}

function findingKey(finding: StructuredFinding): string {
  const paths = [...(finding.paths ?? [])].sort().join(",");
  return [
    finding.severity,
    normalizeText(finding.title),
    normalizeText(paths)
  ].join("|");
}

function findingCounts(run: LoadedRun): Record<string, number> {
  const counts = run.summary?.findingCounts ?? run.meta?.findingCounts;
  if (counts) {
    return counts;
  }
  return run.findings.reduce<Record<string, number>>((accumulator, finding) => {
    accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
    return accumulator;
  }, {});
}

function renderFindingList(title: string, findings: StructuredFinding[]): string {
  if (!findings.length) {
    return `## ${title}\n\nNone.`;
  }
  return `## ${title}

${findings.map((finding) => [
    `- ${finding.severity.toUpperCase()}: ${finding.title}`,
    finding.paths.length ? `  Paths: ${finding.paths.map((item) => `\`${item}\``).join(", ")}` : undefined,
    finding.recommendation ? `  Recommendation: ${finding.recommendation}` : undefined
  ].filter(Boolean).join("\n")).join("\n")}`;
}

function renderMetricRow(fileName: string, oldMetrics: ReportMetric[], newMetrics: ReportMetric[]): string {
  const oldMetric = oldMetrics.find((metric) => metric.fileName === fileName) ?? emptyMetric(fileName);
  const newMetric = newMetrics.find((metric) => metric.fileName === fileName) ?? emptyMetric(fileName);
  return `| ${fileName} | ${oldMetric.lines} | ${newMetric.lines} | ${formatDelta(newMetric.lines - oldMetric.lines)} | ${oldMetric.headings} | ${newMetric.headings} | ${oldMetric.pathEvidence} | ${newMetric.pathEvidence} |`;
}

function renderPhaseRows(oldRun: LoadedRun, newRun: LoadedRun): string {
  const phaseIds = Array.from(new Set([
    ...(oldRun.summary?.phases ?? oldRun.meta?.phases ?? []).map((phase) => phase.id).filter((id): id is string => Boolean(id)),
    ...(newRun.summary?.phases ?? newRun.meta?.phases ?? []).map((phase) => phase.id).filter((id): id is string => Boolean(id))
  ]));
  if (!phaseIds.length) {
    return "| n/a | not available | not available |";
  }
  return phaseIds.map((phaseId) => {
    const oldPhase = findPhase(oldRun, phaseId);
    const newPhase = findPhase(newRun, phaseId);
    return `| ${phaseId} | ${displayPhase(oldPhase)} | ${displayPhase(newPhase)} |`;
  }).join("\n");
}

function findPhase(run: LoadedRun, phaseId: string): SummaryPhase | undefined {
  return (run.summary?.phases ?? run.meta?.phases ?? []).find((phase) => phase.id === phaseId);
}

function displayPhase(phase: SummaryPhase | undefined): string {
  if (!phase) {
    return "not available";
  }
  const quality = phase.qualityPassed === undefined ? "quality n/a" : phase.qualityPassed ? "quality passed" : "quality warnings";
  return `${phase.status ?? "unknown"}, ${quality}`;
}

function displayProvider(run: LoadedRun): string {
  return run.summary?.ai?.displayName ?? run.summary?.ai?.provider ?? run.meta?.ai.displayName ?? run.meta?.ai.provider ?? "not recorded";
}

function displayModel(run: LoadedRun): string {
  return run.summary?.ai?.model ?? run.summary?.codex?.model ?? run.meta?.ai.model ?? run.meta?.codex.model ?? "not recorded";
}

function displayReasoning(run: LoadedRun): string {
  return run.summary?.ai?.reasoning ?? run.summary?.codex?.reasoning ?? run.meta?.ai.reasoning ?? run.meta?.codex.reasoning ?? "not recorded";
}

function displayChecks(run: LoadedRun): string {
  const checks = run.summary?.evidence?.checks;
  if (!checks) {
    return "not recorded";
  }
  if (!checks.enabled) {
    return "disabled";
  }
  const commandCount = checks.commands?.length ?? 0;
  return `${commandCount} command(s), ${checks.failed ? "failed" : "passed"}`;
}

function countPathEvidence(markdown: string): number {
  const matches = new Set<string>();
  const pathPattern = /(?:^|[\s`])((?:\.?\/)?(?:src|test|tests|lib|app|scripts|docs|\.github)[/\w.-]*|(?:package(?:-lock)?\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod))(?=$|[\s`)\],.;:])/gm;
  for (const match of markdown.matchAll(pathPattern)) {
    matches.add(match[1].replace(/^\.\//, "").replace(/\/+$/g, ""));
  }
  return matches.size;
}

function emptyMetric(fileName: string): ReportMetric {
  return {
    fileName,
    lines: 0,
    headings: 0,
    pathEvidence: 0
  };
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
