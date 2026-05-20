import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportPath } from "./reports.js";
import type {
  AuditMeta,
  EvidencePack,
  FindingEvidenceReference,
  ReportExportFormat,
  RunPaths,
  StructuredFinding,
  StructuredPhaseReport
} from "./types.js";

export interface FindingExportPaths {
  findingsSarif?: string;
  findingsJsonl?: string;
  htmlReport?: string;
  githubAnnotationsJson?: string;
}

export interface FindingExportContext {
  meta?: AuditMeta;
  evidence?: EvidencePack;
  structuredReports?: StructuredPhaseReport[];
  suppressedFindings?: StructuredFinding[];
  paths?: RunPaths;
}

export async function writeFindingExports(
  paths: RunPaths,
  findings: StructuredFinding[],
  formats: ReportExportFormat[],
  context: FindingExportContext = {}
): Promise<FindingExportPaths> {
  const uniqueFormats = new Set(formats);
  const outputs: FindingExportPaths = {};

  if (uniqueFormats.has("jsonl")) {
    outputs.findingsJsonl = reportPath(paths.runDir, "findings.jsonl");
    await writeFile(outputs.findingsJsonl, `${findings.map((finding) => JSON.stringify(finding)).join("\n")}\n`, "utf8");
  }

  if (uniqueFormats.has("sarif")) {
    outputs.findingsSarif = reportPath(paths.runDir, "findings.sarif");
    await writeFile(outputs.findingsSarif, `${JSON.stringify(toSarif(findings), null, 2)}\n`, "utf8");
  }

  if (uniqueFormats.has("html")) {
    outputs.htmlReport = reportPath(paths.runDir, "report.html");
    await writeFile(outputs.htmlReport, await renderHtml(findings, { ...context, paths }), "utf8");
  }

  if (uniqueFormats.has("github")) {
    outputs.githubAnnotationsJson = reportPath(paths.runDir, "github-annotations.json");
    await writeFile(outputs.githubAnnotationsJson, `${JSON.stringify(toGithubAnnotations(findings), null, 2)}\n`, "utf8");
  }

  return outputs;
}

function toSarif(findings: StructuredFinding[]): Record<string, unknown> {
  const rules = new Map(findings.map((finding) => [ruleId(finding), {
    id: ruleId(finding),
    name: finding.title,
    shortDescription: { text: finding.title },
    fullDescription: { text: finding.problemRationale ?? finding.evidence ?? finding.title },
    helpUri: "https://github.com/nordbyte/RepoVista",
    help: { text: finding.recommendation ?? "Review the RepoVista finding." },
    properties: {
      severity: finding.severity,
      category: finding.category,
      confidence: finding.confidence,
      tags: ["repovista", finding.category, finding.severity].filter(Boolean)
    }
  }]));
  return {
    version: "2.1.0",
    "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "RepoVista",
            informationUri: "https://github.com/nordbyte/RepoVista",
            rules: Array.from(rules.values())
          }
        },
        results: findings.map((finding) => ({
          ruleId: ruleId(finding),
          level: sarifLevel(finding.severity),
          message: { text: finding.evidence ?? finding.title },
          locations: findingLocations(finding),
          partialFingerprints: {
            repovistaSignature: finding.signature ?? finding.id
          },
          properties: {
            findingId: finding.id,
            status: finding.status ?? "open",
            confidence: finding.confidence
          }
        }))
      }
    ]
  };
}

function findingLocations(finding: StructuredFinding): Array<Record<string, unknown>> {
  const references = findingReferences(finding);
  return references.map((reference) => ({
    physicalLocation: {
      artifactLocation: {
        uri: reference.path
      },
      region: {
        startLine: reference.startLine ?? 1,
        endLine: reference.endLine ?? reference.startLine ?? 1
      }
    }
  }));
}

function sarifLevel(severity: StructuredFinding["severity"]): "error" | "warning" | "note" | "none" {
  if (severity === "critical" || severity === "high") {
    return "error";
  }
  if (severity === "medium") {
    return "warning";
  }
  if (severity === "low") {
    return "note";
  }
  return "none";
}

function toGithubAnnotations(findings: StructuredFinding[]): Array<Record<string, unknown>> {
  return findings.flatMap((finding) => {
    const references = findingReferences(finding);
    return references.map((reference) => ({
      path: reference.path,
      start_line: reference.startLine ?? 1,
      end_line: reference.endLine ?? reference.startLine ?? 1,
      annotation_level: githubLevel(finding.severity),
      message: `${finding.title}: ${finding.evidence ?? finding.recommendation ?? "RepoVista finding"}`,
      title: finding.title,
      raw_details: [
        finding.problemRationale,
        finding.recommendation ? `Recommendation: ${finding.recommendation}` : undefined,
        finding.signature ? `Signature: ${finding.signature}` : undefined
      ].filter(Boolean).join("\n\n")
    }));
  });
}

function githubLevel(severity: StructuredFinding["severity"]): "failure" | "warning" | "notice" {
  if (severity === "critical" || severity === "high") {
    return "failure";
  }
  if (severity === "medium") {
    return "warning";
  }
  return "notice";
}

function findingReferences(finding: StructuredFinding): FindingEvidenceReference[] {
  if (finding.evidenceDetails?.length) {
    return finding.evidenceDetails;
  }
  if (finding.evidenceReferences?.length) {
    return finding.evidenceReferences.map((reference) => typeof reference === "string" ? { path: reference } : reference);
  }
  return finding.paths.map((path) => ({ path }));
}

function evidenceSnippetId(reference: FindingEvidenceReference): string {
  return `evidence-${reference.path}-${reference.startLine ?? 1}-${reference.endLine ?? reference.startLine ?? 1}`
    .replace(/[^A-Za-z0-9_-]/g, "-");
}

function findingCompareKey(finding: StructuredFinding): string {
  return finding.signature ?? `${finding.severity}|${finding.title}|${finding.paths.join(",")}`.toLowerCase();
}

function ruleId(finding: StructuredFinding): string {
  return `repovista/${finding.signature ?? finding.id}`.replace(/[^A-Za-z0-9_.:/-]/g, "_");
}

async function renderHtml(findings: StructuredFinding[], context: FindingExportContext): Promise<string> {
  const meta = context.meta;
  const markdownSections = await loadMarkdownSections(context.paths?.runDir);
  const evidenceSnippets = await loadEvidenceSnippets(findings, meta?.projectRoot);
  const compareSummary = await loadPreviousRunComparison(context.paths, findings);
  const severities = ["all", "critical", "high", "medium", "low", "unknown"];
  const statuses = ["all", ...Array.from(new Set(findings.map((finding) => finding.status ?? "open"))).sort()];
  const features = ["all", ...Array.from(new Set(findings.map((finding) => finding.featureId).filter((value): value is string => Boolean(value)))).sort()];
  const phaseRows = (context.structuredReports ?? []).map((report) => `<tr>
<td>${escapeHtml(report.phaseId)}</td>
<td>${escapeHtml(report.executiveSummary ?? report.keyPoints[0] ?? "")}</td>
<td>${escapeHtml(String(report.evidenceReferences.length))}</td>
<td>${escapeHtml(String(report.recommendations.length))}</td>
</tr>`).join("\n");
  const findingCards = findings.map((finding) => renderFindingCard(finding, evidenceSnippets)).join("\n");
  const proposals = (context.structuredReports ?? [])
    .flatMap((report) => report.proposals ?? [])
    .map((proposal) => `<li><strong>${escapeHtml(proposal.title)}</strong><br>${escapeHtml(proposal.description)}<br><small>${escapeHtml(proposal.priority)} priority, ${escapeHtml(proposal.effort)} effort, ${escapeHtml(proposal.confidence)} confidence</small></li>`)
    .join("\n");
  const analytics = meta?.analytics;
  const analyticsRows = analytics?.phases.map((phase) => `<tr>
<td>${escapeHtml(phase.id)}</td>
<td>${escapeHtml(phase.status)}</td>
<td>${Math.round(phase.durationMs)}ms</td>
<td>${phase.promptTokens}</td>
<td>${escapeHtml(phase.actualTotalTokens === undefined ? "n/a" : String(phase.actualTotalTokens))}</td>
<td>${escapeHtml(phase.actualCostUsd === undefined ? "n/a" : `$${phase.actualCostUsd}`)}</td>
</tr>`).join("\n") ?? "";
  const severityCounts = countBy(findings, (finding) => finding.severity);
  const statusCounts = countBy(findings, (finding) => finding.status ?? "open");
  const checkRows = (context.evidence?.checks.results ?? []).map((result) => `<tr>
<td><code>${escapeHtml(result.command)}</code></td>
<td>${escapeHtml(String(result.exitCode ?? "n/a"))}</td>
<td>${Math.round(result.durationMs)}ms</td>
<td>${result.timedOut ? "yes" : "no"}</td>
</tr>`).join("\n");
  const phaseQualityRows = (meta?.phases ?? []).map((phase) => `<tr>
<td>${escapeHtml(phase.id)}</td>
<td>${escapeHtml(phase.status)}</td>
<td>${escapeHtml(phase.qualityPassed === undefined ? "not recorded" : phase.qualityPassed ? "passed" : "warnings")}</td>
<td>${escapeHtml(phase.qualityScore === undefined ? "n/a" : String(phase.qualityScore))}</td>
<td>${escapeHtml((phase.qualityWarnings ?? []).join("; ") || phase.error || "")}</td>
</tr>`).join("\n");
  const suppressedRows = (context.suppressedFindings ?? []).map((finding) => `<tr>
<td>${escapeHtml(finding.severity)}</td>
<td>${escapeHtml(finding.title)}</td>
<td>${escapeHtml(finding.paths.join(", ") || "n/a")}</td>
<td>${escapeHtml(finding.recommendation ?? "")}</td>
</tr>`).join("\n");
  const outputLinks = Object.entries(meta?.outputs ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([label, value]) => `<li><strong>${escapeHtml(label)}</strong>: ${renderArtifactLink(String(value), label)}</li>`)
    .join("\n");
  const generatedLinks = context.paths ? renderGeneratedArtifactLinks(context.paths) : "";
  const markdownSectionHtml = markdownSections.map((section) => `<details class="report-section" open>
    <summary>${escapeHtml(section.title)}</summary>
    <div class="markdown-section">${renderMarkdown(section.content)}</div>
  </details>`).join("\n");
  const compareHtml = compareSummary ? renderCompareSummary(compareSummary) : "<p class=\"muted\">No previous report run was available for comparison.</p>";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RepoVista Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; color: #171717; line-height: 1.45; background: #f7f8fb; }
    main { max-width: 1500px; margin: 0 auto; padding: 1.5rem; }
    header { background: #111827; color: #fff; margin: 0 0 1.5rem; padding: 1.5rem; }
    header h1 { margin: 0 0 .35rem; }
    .meta, .scoreboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; margin: 1rem 0; }
    .meta div, .scoreboard div, section { border: 1px solid #d4d4d4; padding: .85rem; border-radius: 6px; background: #fff; }
    header .meta div { background: #1f2937; border-color: #374151; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .75rem; margin: 1rem 0; align-items: end; }
    label { display: grid; gap: .25rem; font-size: .9rem; font-weight: 600; }
    input, select { font: inherit; padding: .45rem .55rem; border: 1px solid #bdbdbd; border-radius: 6px; background: #fff; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d4d4d4; padding: .5rem; vertical-align: top; }
    th { background: #f5f5f5; text-align: left; }
    section { margin-top: 1rem; overflow-x: auto; }
    details { border: 1px solid #d4d4d4; border-radius: 6px; background: #fff; margin: .75rem 0; padding: .75rem; }
    details summary { cursor: pointer; font-weight: 700; }
    .finding-card[data-severity="critical"] { border-left: 5px solid #991b1b; }
    .finding-card[data-severity="high"] { border-left: 5px solid #dc2626; }
    .finding-card[data-severity="medium"] { border-left: 5px solid #d97706; }
    .finding-card[data-severity="low"] { border-left: 5px solid #059669; }
    .finding-meta { display: flex; flex-wrap: wrap; gap: .45rem; margin: .6rem 0; }
    .pill { border: 1px solid #d4d4d4; border-radius: 999px; padding: .15rem .5rem; background: #f8fafc; font-size: .85rem; }
    .snippet { background: #111827; color: #f9fafb; padding: .75rem; overflow-x: auto; border-radius: 6px; }
    .report-section { padding: 0; }
    .report-section summary { padding: .75rem; }
    .markdown-section { padding: 0 .9rem .9rem; }
    code { overflow-wrap: anywhere; }
    li { margin-bottom: .75rem; }
    .muted { color: #666; }
    .hidden { display: none; }
    .split { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1rem; }
  </style>
</head>
<body>
  <header>
    <h1>RepoVista Report</h1>
    <div class="meta">
      <div><strong>Run</strong><br>${escapeHtml(meta?.runId ?? "finding-state")}</div>
      <div><strong>Provider</strong><br>${escapeHtml(meta?.ai.displayName ?? "not recorded")}</div>
      <div><strong>Model</strong><br>${escapeHtml(meta?.ai.model ?? "not recorded")}</div>
      <div><strong>Reasoning</strong><br>${escapeHtml(meta?.ai.reasoning ?? "not recorded")}</div>
      <div><strong>Checks</strong><br>${escapeHtml(context.evidence?.checks.enabled ? `${context.evidence.checks.commands.length} command(s)` : "disabled")}</div>
      <div><strong>Suppressed</strong><br>${escapeHtml(String(context.suppressedFindings?.length ?? 0))}</div>
      <div><strong>Estimated input tokens</strong><br>${escapeHtml(String(analytics?.estimatedInputTokens ?? "not recorded"))}</div>
      <div><strong>Actual tokens</strong><br>${escapeHtml(String(analytics?.actualTotalTokens ?? "not recorded"))}</div>
      <div><strong>Actual cost</strong><br>${escapeHtml(analytics?.actualCostUsd === undefined ? "not recorded" : `$${analytics.actualCostUsd}`)}</div>
      <div><strong>Total phase time</strong><br>${escapeHtml(analytics ? `${Math.round(analytics.totalDurationMs)}ms` : "not recorded")}</div>
    </div>
  </header>
  <main>
  <div class="scoreboard" aria-label="Finding summary">
    <div><strong>Total findings</strong><br>${findings.length}</div>
    <div><strong>Critical</strong><br>${severityCounts.critical ?? 0}</div>
    <div><strong>High</strong><br>${severityCounts.high ?? 0}</div>
    <div><strong>Medium</strong><br>${severityCounts.medium ?? 0}</div>
    <div><strong>Open</strong><br>${statusCounts.open ?? 0}</div>
    <div><strong>Suppressed</strong><br>${context.suppressedFindings?.length ?? 0}</div>
  </div>
  <section>
  <h2>Findings</h2>
  <div class="filters">
    <label>Search <input id="finding-search" type="search" placeholder="title, path, recommendation"></label>
    <label>Severity <select id="severity-filter">${severities.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select></label>
    <label>Status <select id="status-filter">${statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select></label>
    <label>Feature <select id="feature-filter">${features.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select></label>
  </div>
  <p class="muted" id="finding-count">${findings.length} finding(s)</p>
  <div id="finding-cards">${findingCards || "<p>No findings</p>"}</div>
  </section>
  <section>
  <h2>Report Sections</h2>
  ${markdownSectionHtml || "<p class=\"muted\">No Markdown report sections recorded.</p>"}
  </section>
  <section>
  <h2>Report Comparison</h2>
  ${compareHtml}
  </section>
  <div class="split">
  <section>
  <h2>Evidence Pack</h2>
  <p class="muted">Checks: ${escapeHtml(context.evidence?.checks.enabled ? "enabled" : "disabled")} (${escapeHtml(String(context.evidence?.checks.commands.length ?? 0))} configured)</p>
  <table>
    <thead><tr><th>Command</th><th>Exit</th><th>Duration</th><th>Timeout</th></tr></thead>
    <tbody>${checkRows || "<tr><td colspan=\"4\">No local check results recorded.</td></tr>"}</tbody>
  </table>
  </section>
  <section>
  <h2>Phase Quality</h2>
  <table>
    <thead><tr><th>Phase</th><th>Status</th><th>Quality</th><th>Score</th><th>Notes</th></tr></thead>
    <tbody>${phaseQualityRows || "<tr><td colspan=\"5\">No phase quality recorded.</td></tr>"}</tbody>
  </table>
  </section>
  </div>
  <section>
  <h2>Run Analytics</h2>
  <table>
    <thead><tr><th>Phase</th><th>Status</th><th>Duration</th><th>Prompt Tokens</th><th>Actual Tokens</th><th>Actual Cost</th></tr></thead>
    <tbody>${analyticsRows || "<tr><td colspan=\"6\">No analytics recorded.</td></tr>"}</tbody>
  </table>
  </section>
  <section>
  <h2>Phase Summaries</h2>
  <table>
    <thead><tr><th>Phase</th><th>Summary</th><th>Evidence refs</th><th>Recommendations</th></tr></thead>
    <tbody>${phaseRows || "<tr><td colspan=\"4\">No structured phase summaries</td></tr>"}</tbody>
  </table>
  </section>
  <section>
  <h2>Roadmap Proposals</h2>
  <ul>${proposals || "<li>No roadmap proposals recorded.</li>"}</ul>
  </section>
  <section>
  <h2>Suppressed Findings</h2>
  <table>
    <thead><tr><th>Severity</th><th>Title</th><th>Paths</th><th>Recommendation</th></tr></thead>
    <tbody>${suppressedRows || "<tr><td colspan=\"4\">No suppressed findings recorded.</td></tr>"}</tbody>
  </table>
  </section>
  <section>
  <h2>Artifacts</h2>
  <ul>${generatedLinks}${outputLinks || ""}${generatedLinks || outputLinks ? "" : "<li>No artifact paths recorded.</li>"}</ul>
  </section>
  </main>
  <script>
    const rows = Array.from(document.querySelectorAll(".finding-row"));
    const search = document.getElementById("finding-search");
    const severity = document.getElementById("severity-filter");
    const status = document.getElementById("status-filter");
    const feature = document.getElementById("feature-filter");
    const count = document.getElementById("finding-count");
    function applyFilters() {
      const text = String(search.value || "").toLowerCase();
      let visible = 0;
      for (const row of rows) {
        const matches = (!text || row.dataset.search.includes(text)) &&
          (severity.value === "all" || row.dataset.severity === severity.value) &&
          (status.value === "all" || row.dataset.status === status.value) &&
          (feature.value === "all" || row.dataset.feature === feature.value);
        row.classList.toggle("hidden", !matches);
        if (matches) visible += 1;
      }
      count.textContent = visible + " of " + rows.length + " finding(s)";
    }
    [search, severity, status, feature].forEach((control) => control.addEventListener("input", applyFilters));
  </script>
</body>
</html>
`;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const itemKey = key(value);
    counts[itemKey] = (counts[itemKey] ?? 0) + 1;
    return counts;
  }, {});
}

interface HtmlMarkdownSection {
  title: string;
  fileName: string;
  content: string;
}

interface HtmlEvidenceSnippet {
  id: string;
  label: string;
  path: string;
  startLine?: number;
  endLine?: number;
  code: string;
}

interface HtmlCompareSummary {
  previousRunId: string;
  added: StructuredFinding[];
  resolved: StructuredFinding[];
  persisting: number;
}

async function loadMarkdownSections(runDir: string | undefined): Promise<HtmlMarkdownSection[]> {
  if (!runDir) {
    return [];
  }
  const definitions = [
    ["index.md", "Summary"],
    ["00-inventory.md", "Evidence Pack"],
    ["01-architecture-report.md", "Architecture"],
    ["02-code-quality-report.md", "Code Quality"],
    ["03-risk-and-bug-report.md", "Risk and Bug"],
    ["04-feature-roadmap.md", "Feature Roadmap"]
  ] as const;
  const sections: HtmlMarkdownSection[] = [];
  for (const [fileName, title] of definitions) {
    try {
      sections.push({ fileName, title, content: await readFile(path.join(runDir, fileName), "utf8") });
    } catch {
      // Optional report sections are omitted when a run was partial.
    }
  }
  return sections;
}

async function loadEvidenceSnippets(findings: StructuredFinding[], projectRoot: string | undefined): Promise<Map<string, HtmlEvidenceSnippet>> {
  const snippets = new Map<string, HtmlEvidenceSnippet>();
  if (!projectRoot) {
    return snippets;
  }
  for (const finding of findings) {
    for (const reference of findingReferences(finding)) {
      const key = evidenceSnippetId(reference);
      if (snippets.has(key)) {
        continue;
      }
      const snippet = await readEvidenceSnippet(projectRoot, reference);
      if (snippet) {
        snippets.set(key, snippet);
      }
    }
  }
  return snippets;
}

async function readEvidenceSnippet(projectRoot: string, reference: FindingEvidenceReference): Promise<HtmlEvidenceSnippet | undefined> {
  const filePath = path.resolve(projectRoot, reference.path);
  const relative = path.relative(projectRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  try {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    const start = Math.max(1, reference.startLine ?? 1);
    const end = Math.min(lines.length, Math.max(start, reference.endLine ?? start + 6));
    const code = lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(4, " ")} | ${line}`).join("\n");
    return {
      id: evidenceSnippetId(reference),
      label: `${reference.path}${reference.startLine ? `:${reference.startLine}` : ""}`,
      path: reference.path,
      startLine: reference.startLine,
      endLine: reference.endLine,
      code
    };
  } catch {
    return undefined;
  }
}

async function loadPreviousRunComparison(paths: RunPaths | undefined, currentFindings: StructuredFinding[]): Promise<HtmlCompareSummary | undefined> {
  if (!paths) {
    return undefined;
  }
  let entries;
  try {
    entries = await readdir(paths.outRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name !== paths.runId && /^20\d{2}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  const previousRunId = candidates.find((name) => name < paths.runId) ?? candidates[0];
  if (!previousRunId) {
    return undefined;
  }
  try {
    const previousFindings = JSON.parse(await readFile(path.join(paths.outRoot, previousRunId, "findings.json"), "utf8")) as StructuredFinding[];
    const previousByKey = new Map(previousFindings.map((finding) => [findingCompareKey(finding), finding]));
    const currentByKey = new Map(currentFindings.map((finding) => [findingCompareKey(finding), finding]));
    return {
      previousRunId,
      added: currentFindings.filter((finding) => !previousByKey.has(findingCompareKey(finding))),
      resolved: previousFindings.filter((finding) => !currentByKey.has(findingCompareKey(finding))),
      persisting: currentFindings.filter((finding) => previousByKey.has(findingCompareKey(finding))).length
    };
  } catch {
    return undefined;
  }
}

function renderFindingCard(finding: StructuredFinding, snippets: Map<string, HtmlEvidenceSnippet>): string {
  const refs = findingReferences(finding);
  const snippetHtml = refs
    .map((reference) => snippets.get(evidenceSnippetId(reference)))
    .filter((snippet): snippet is HtmlEvidenceSnippet => Boolean(snippet))
    .map((snippet) => `<h4 id="${escapeHtml(snippet.id)}">${escapeHtml(snippet.label)}</h4><pre class="snippet"><code>${escapeHtml(snippet.code)}</code></pre>`)
    .join("\n");
  return `<details class="finding-card finding-row" data-severity="${escapeHtml(finding.severity)}" data-status="${escapeHtml(finding.status ?? "open")}" data-feature="${escapeHtml(finding.featureId ?? "")}" data-search="${escapeHtml(searchTextForFinding(finding))}">
<summary>${escapeHtml(finding.severity.toUpperCase())}: ${escapeHtml(finding.title)}</summary>
<div class="finding-meta">
  <span class="pill">${escapeHtml(finding.status ?? "open")}</span>
  <span class="pill">${escapeHtml(finding.category ?? "uncategorized")}</span>
  <span class="pill">owner: ${escapeHtml(finding.owner ?? "n/a")}</span>
  <span class="pill">labels: ${escapeHtml(finding.labels?.join(", ") || "n/a")}</span>
  <span class="pill">SLA: ${escapeHtml(finding.sla ? `${finding.sla.dueAt}${finding.sla.overdue ? " overdue" : ""}` : "n/a")}</span>
</div>
<p><strong>Paths:</strong> ${escapeHtml(finding.paths.join(", ") || "n/a")}</p>
<p><strong>Evidence:</strong> ${escapeHtml(finding.evidence ?? "n/a")}</p>
<p><strong>Recommendation:</strong> ${escapeHtml(finding.recommendation ?? "n/a")}</p>
<p><strong>Issue:</strong> ${finding.issue?.url ? `<a href="${escapeHtml(finding.issue.url)}">${escapeHtml(finding.issue.url)}</a>` : "n/a"}</p>
<p><strong>Evidence refs:</strong><br>${renderEvidenceLinks(finding)}</p>
${snippetHtml || "<p class=\"muted\">No local evidence snippet available.</p>"}
</details>`;
}

function renderCompareSummary(summary: HtmlCompareSummary): string {
  return `<div class="scoreboard">
    <div><strong>Previous run</strong><br>${escapeHtml(summary.previousRunId)}</div>
    <div><strong>Added</strong><br>${summary.added.length}</div>
    <div><strong>Resolved</strong><br>${summary.resolved.length}</div>
    <div><strong>Persisting</strong><br>${summary.persisting}</div>
  </div>
  <details><summary>Added findings</summary>${renderCompactFindingList(summary.added)}</details>
  <details><summary>Resolved findings</summary>${renderCompactFindingList(summary.resolved)}</details>`;
}

function renderCompactFindingList(findings: StructuredFinding[]): string {
  return findings.length
    ? `<ul>${findings.map((finding) => `<li>${escapeHtml(finding.severity.toUpperCase())}: ${escapeHtml(finding.title)} <code>${escapeHtml(finding.paths.join(", ") || "n/a")}</code></li>`).join("")}</ul>`
    : "<p class=\"muted\">None.</p>";
}

function renderArtifactLink(filePath: string, label: string): string {
  const href = path.basename(filePath);
  return `<a href="${escapeHtml(href)}" download>${escapeHtml(path.basename(filePath) || label)}</a> <code>${escapeHtml(filePath)}</code>`;
}

function renderGeneratedArtifactLinks(paths: RunPaths): string {
  return [
    "index.md",
    "report.json",
    "summary.json",
    "findings.json",
    "findings.jsonl",
    "findings.sarif",
    "structured-reports.json",
    "prompt-manifest.json"
  ].map((fileName) => `<li><strong>${escapeHtml(fileName)}</strong>: <a href="${escapeHtml(fileName)}" download>${escapeHtml(fileName)}</a></li>`).join("\n");
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length + 1);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const list = /^\s*[-*]\s+(.+)$/.exec(line);
    if (list) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(list[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeList();
  return html.join("\n");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderEvidenceLinks(finding: StructuredFinding): string {
  const references = findingReferences(finding);
  if (!references.length) {
    return "n/a";
  }
  return references.map((reference) => {
    const label = `${reference.path}${reference.startLine ? `:${reference.startLine}` : ""}`;
    return `<a href="#${escapeHtml(evidenceSnippetId(reference))}" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
  }).join("<br>");
}

function searchTextForFinding(finding: StructuredFinding): string {
  return [
    finding.title,
    finding.severity,
    finding.status,
    finding.category,
    finding.owner,
    finding.labels?.join(" "),
    finding.paths.join(" "),
    finding.evidence,
    finding.recommendation,
    finding.problemRationale,
    finding.featureId
  ].filter(Boolean).join(" ").toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
