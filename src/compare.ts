import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import type { AuditMeta, CompareFormat, StructuredFinding, StructuredPhaseReport, StructuredRoadmapProposal } from "./types.js";

export interface LoadedRun {
  runDir: string;
  runId: string;
  summary?: RunSummary;
  meta?: AuditMeta;
  findings: StructuredFinding[];
  structuredReports: StructuredPhaseReport[];
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

export interface RunComparison {
  oldRun: LoadedRun;
  newRun: LoadedRun;
  findingCounts: {
    old: Record<string, number>;
    new: Record<string, number>;
    deltas: Record<string, number>;
  };
  changes: {
    added: StructuredFinding[];
    resolved: StructuredFinding[];
    persisting: StructuredFinding[];
  };
  proposals: {
    added: StructuredRoadmapProposal[];
    removed: StructuredRoadmapProposal[];
    persisting: StructuredRoadmapProposal[];
  };
  evidenceQuality: {
    old: number;
    new: number;
    delta: number;
  };
  providerDelta: {
    providerChanged: boolean;
    modelChanged: boolean;
    reasoningChanged: boolean;
  };
  regressions: StructuredFinding[];
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
  projectRoot = process.cwd(),
  options: { format?: CompareFormat } = {}
): Promise<string> {
  const comparison = await buildRunComparison(projectRoot, oldRunDirectory, newRunDirectory);
  if (options.format === "json") {
    return `${JSON.stringify(comparison, null, 2)}\n`;
  }
  if (options.format === "html") {
    return renderRunComparisonHtml(comparison);
  }
  return renderRunComparison(comparison.oldRun, comparison.newRun);
}

export async function compareHasRegression(
  oldRunDirectory: string,
  newRunDirectory: string,
  projectRoot = process.cwd()
): Promise<boolean> {
  const comparison = await buildRunComparison(projectRoot, oldRunDirectory, newRunDirectory);
  return comparison.regressions.length > 0;
}

export async function compareGateViolations(
  oldRunDirectory: string,
  newRunDirectory: string,
  projectRoot = process.cwd(),
  thresholds: {
    maxNewCritical?: number;
    maxNewHigh?: number;
    maxNewMedium?: number;
  } = {}
): Promise<string[]> {
  const comparison = await buildRunComparison(projectRoot, oldRunDirectory, newRunDirectory);
  const addedCounts = findingSeverityCounts(comparison.changes.added);
  return [
    ...thresholdViolation("new critical findings", addedCounts.critical ?? 0, thresholds.maxNewCritical),
    ...thresholdViolation("new high findings", addedCounts.high ?? 0, thresholds.maxNewHigh),
    ...thresholdViolation("new medium findings", addedCounts.medium ?? 0, thresholds.maxNewMedium)
  ];
}

export async function buildRunComparison(
  projectRoot: string,
  oldRunDirectory: string,
  newRunDirectory: string
): Promise<RunComparison> {
  const oldRun = await loadRun(projectRoot, oldRunDirectory);
  const newRun = await loadRun(projectRoot, newRunDirectory);
  const changes = diffFindings(oldRun.findings, newRun.findings);
  const proposalChanges = diffProposals(roadmapProposals(oldRun), roadmapProposals(newRun));
  const oldCounts = findingCounts(oldRun);
  const newCounts = findingCounts(newRun);
  const oldEvidenceQuality = evidenceQualityScore(oldRun.findings);
  const newEvidenceQuality = evidenceQualityScore(newRun.findings);
  const severities = ["critical", "high", "medium", "low", "unknown"];
  const deltas = Object.fromEntries(severities.map((severity) => [
    severity,
    (newCounts[severity] ?? 0) - (oldCounts[severity] ?? 0)
  ]));
  return {
    oldRun,
    newRun,
    findingCounts: {
      old: oldCounts,
      new: newCounts,
      deltas
    },
    changes,
    proposals: proposalChanges,
    evidenceQuality: {
      old: oldEvidenceQuality,
      new: newEvidenceQuality,
      delta: newEvidenceQuality - oldEvidenceQuality
    },
    providerDelta: {
      providerChanged: displayProvider(oldRun) !== displayProvider(newRun),
      modelChanged: displayModel(oldRun) !== displayModel(newRun),
      reasoningChanged: displayReasoning(oldRun) !== displayReasoning(newRun)
    },
    regressions: changes.added.filter((finding) => finding.severity === "critical" || finding.severity === "high")
  };
}

export function renderRunComparison(oldRun: LoadedRun, newRun: LoadedRun): string {
  const diff = diffFindings(oldRun.findings, newRun.findings);
  const proposalChanges = diffProposals(roadmapProposals(oldRun), roadmapProposals(newRun));
  const oldCounts = findingCounts(oldRun);
  const newCounts = findingCounts(newRun);
  const oldEvidenceQuality = evidenceQualityScore(oldRun.findings);
  const newEvidenceQuality = evidenceQualityScore(newRun.findings);

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

Provider changed: ${displayProvider(oldRun) !== displayProvider(newRun) ? "yes" : "no"}; model changed: ${displayModel(oldRun) !== displayModel(newRun) ? "yes" : "no"}; reasoning changed: ${displayReasoning(oldRun) !== displayReasoning(newRun) ? "yes" : "no"}.

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

## Resolved Old Findings

${diff.resolved.length ? diff.resolved.map((finding) => `- ${finding.severity.toUpperCase()}: ${finding.title} (${finding.paths.join(", ") || "no paths"})`).join("\n") : "None."}

## Proposal Changes

- Added proposals: ${proposalChanges.added.length}
- Removed proposals: ${proposalChanges.removed.length}
- Persisting proposals: ${proposalChanges.persisting.length}

${renderProposalList("Added Proposals", proposalChanges.added)}

${renderProposalList("Removed Proposals", proposalChanges.removed)}

## Evidence Quality

| Signal | Old | New | Delta |
|---|---:|---:|---:|
| Finding evidence quality | ${oldEvidenceQuality} | ${newEvidenceQuality} | ${formatDelta(newEvidenceQuality - oldEvidenceQuality)} |

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

export function renderRunComparisonHtml(comparison: RunComparison): string {
  const markdown = renderRunComparison(comparison.oldRun, comparison.newRun);
  const rows = ["critical", "high", "medium", "low", "unknown"].map((severity) => `<tr>
<td>${escapeHtml(severity)}</td>
<td>${comparison.findingCounts.old[severity] ?? 0}</td>
<td>${comparison.findingCounts.new[severity] ?? 0}</td>
<td>${formatDelta(comparison.findingCounts.deltas[severity] ?? 0)}</td>
</tr>`).join("\n");
  const findingRows = [
    ...comparison.changes.added.map((finding) => ({ kind: "added", finding })),
    ...comparison.changes.resolved.map((finding) => ({ kind: "resolved", finding })),
    ...comparison.changes.persisting.map((finding) => ({ kind: "persisting", finding }))
  ].map(({ kind, finding }) => `<tr class="finding-row" data-kind="${kind}" data-severity="${finding.severity}" data-search="${escapeHtml(`${finding.title} ${finding.paths.join(" ")} ${finding.recommendation ?? ""}`.toLowerCase())}">
<td>${kind}</td>
<td>${escapeHtml(finding.severity)}</td>
<td>${escapeHtml(finding.title)}</td>
<td>${escapeHtml(finding.paths.join(", ") || "n/a")}</td>
</tr>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RepoVista Comparison</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #171717; line-height: 1.45; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #d4d4d4; padding: .5rem; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .75rem; margin: 1rem 0; }
    input, select { font: inherit; padding: .45rem .55rem; border: 1px solid #bdbdbd; border-radius: 6px; }
    .hidden { display: none; }
    pre { white-space: pre-wrap; background: #f7f7f7; padding: 1rem; border: 1px solid #d4d4d4; }
  </style>
</head>
<body>
  <h1>RepoVista Comparison</h1>
  <p>Regressions: ${comparison.regressions.length}</p>
  <p>Evidence quality: ${comparison.evidenceQuality.old} -> ${comparison.evidenceQuality.new} (${formatDelta(comparison.evidenceQuality.delta)}). Provider/model/reasoning changed: ${comparison.providerDelta.providerChanged ? "provider " : ""}${comparison.providerDelta.modelChanged ? "model " : ""}${comparison.providerDelta.reasoningChanged ? "reasoning" : ""}${!comparison.providerDelta.providerChanged && !comparison.providerDelta.modelChanged && !comparison.providerDelta.reasoningChanged ? "no" : ""}</p>
  <table>
    <thead><tr><th>Severity</th><th>Old</th><th>New</th><th>Delta</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Finding Changes</h2>
  <div class="filters">
    <label>Search <input id="finding-search" type="search"></label>
    <label>Change <select id="kind-filter"><option value="all">all</option><option value="added">added</option><option value="resolved">resolved</option><option value="persisting">persisting</option></select></label>
    <label>Severity <select id="severity-filter"><option value="all">all</option><option value="critical">critical</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option><option value="unknown">unknown</option></select></label>
  </div>
  <table>
    <thead><tr><th>Change</th><th>Severity</th><th>Title</th><th>Paths</th></tr></thead>
    <tbody>${findingRows || "<tr><td colspan=\"4\">No finding changes</td></tr>"}</tbody>
  </table>
  <h2>Markdown Detail</h2>
  <pre>${escapeHtml(markdown)}</pre>
  <script>
    const rows = Array.from(document.querySelectorAll(".finding-row"));
    const search = document.getElementById("finding-search");
    const kind = document.getElementById("kind-filter");
    const severity = document.getElementById("severity-filter");
    function applyFilters() {
      const text = String(search.value || "").toLowerCase();
      for (const row of rows) {
        const show = (!text || row.dataset.search.includes(text)) &&
          (kind.value === "all" || row.dataset.kind === kind.value) &&
          (severity.value === "all" || row.dataset.severity === severity.value);
        row.classList.toggle("hidden", !show);
      }
    }
    [search, kind, severity].forEach((control) => control.addEventListener("input", applyFilters));
  </script>
</body>
</html>
`;
}

async function loadRun(projectRoot: string, inputDirectory: string): Promise<LoadedRun> {
  const runDir = path.resolve(projectRoot, inputDirectory);
  await assertDirectory(runDir);
  const [summary, meta, findingsJson, structuredReports, reportMetrics] = await Promise.all([
    readJsonFile<RunSummary>(path.join(runDir, "summary.json")),
    readJsonFile<AuditMeta>(path.join(runDir, "meta.json")),
    readJsonFile<StructuredFinding[]>(path.join(runDir, "findings.json")),
    readJsonFile<StructuredPhaseReport[]>(path.join(runDir, "structured-reports.json")),
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
    structuredReports: Array.isArray(structuredReports) ? structuredReports : [],
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

function diffProposals(oldProposals: StructuredRoadmapProposal[], newProposals: StructuredRoadmapProposal[]): {
  added: StructuredRoadmapProposal[];
  removed: StructuredRoadmapProposal[];
  persisting: StructuredRoadmapProposal[];
} {
  const oldByKey = new Map(oldProposals.map((proposal) => [proposalKey(proposal), proposal]));
  const newByKey = new Map(newProposals.map((proposal) => [proposalKey(proposal), proposal]));
  return {
    added: newProposals.filter((proposal) => !oldByKey.has(proposalKey(proposal))),
    removed: oldProposals.filter((proposal) => !newByKey.has(proposalKey(proposal))),
    persisting: newProposals.filter((proposal) => oldByKey.has(proposalKey(proposal)))
  };
}

function roadmapProposals(run: LoadedRun): StructuredRoadmapProposal[] {
  return run.structuredReports.flatMap((report) => report.phaseId === "feature-roadmap" ? report.proposals ?? [] : []);
}

function proposalKey(proposal: StructuredRoadmapProposal): string {
  return [
    normalizeText(proposal.title),
    normalizeText(proposal.affected.join(",")),
    normalizeText(proposal.priority)
  ].join("|");
}

function findingKey(finding: StructuredFinding): string {
  if (finding.signature) {
    return finding.signature;
  }
  if (finding.id?.startsWith("fnd_")) {
    return finding.id;
  }
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

function findingSeverityCounts(findings: StructuredFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    return counts;
  }, {});
}

function thresholdViolation(label: string, count: number, max: number | undefined): string[] {
  return typeof max === "number" && count > max ? [`${label} ${count} exceeds configured maximum ${max}.`] : [];
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

function renderProposalList(title: string, proposals: StructuredRoadmapProposal[]): string {
  if (!proposals.length) {
    return `## ${title}\n\nNone.`;
  }
  return `## ${title}

${proposals.map((proposal) => [
    `- ${proposal.title}`,
    proposal.priority ? `  Priority: ${proposal.priority}` : undefined,
    proposal.affected.length ? `  Affected: ${proposal.affected.map((item) => `\`${item}\``).join(", ")}` : undefined,
    proposal.benefit ? `  Benefit: ${proposal.benefit}` : undefined
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

function evidenceQualityScore(findings: StructuredFinding[]): number {
  if (!findings.length) {
    return 100;
  }
  const scores = findings.map((finding) => {
    const refs = finding.evidenceDetails?.length
      ? finding.evidenceDetails
      : (finding.evidenceReferences ?? []).map((reference) => typeof reference === "string" ? { path: reference } : reference);
    let score = 0;
    score += finding.paths.length ? 15 : 0;
    score += refs.length ? 15 : 0;
    score += refs.some((reference) => reference.startLine && reference.endLine) ? 20 : 0;
    score += refs.some((reference) => reference.quote) ? 15 : 0;
    score += finding.reproduction ? 10 : 0;
    score += finding.suggestedRegressionTest ? 10 : 0;
    score += finding.minimumFixScope ? 10 : 0;
    score += finding.evidenceValidation?.passed ? 5 : 0;
    return Math.min(100, score);
  });
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
