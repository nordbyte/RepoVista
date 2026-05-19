import { writeFile } from "node:fs/promises";
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
    await writeFile(outputs.htmlReport, renderHtml(findings, context), "utf8");
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

function ruleId(finding: StructuredFinding): string {
  return `repovista/${finding.signature ?? finding.id}`.replace(/[^A-Za-z0-9_.:/-]/g, "_");
}

function renderHtml(findings: StructuredFinding[], context: FindingExportContext): string {
  const meta = context.meta;
  const severities = ["all", "critical", "high", "medium", "low", "unknown"];
  const statuses = ["all", ...Array.from(new Set(findings.map((finding) => finding.status ?? "open"))).sort()];
  const features = ["all", ...Array.from(new Set(findings.map((finding) => finding.featureId).filter((value): value is string => Boolean(value)))).sort()];
  const phaseRows = (context.structuredReports ?? []).map((report) => `<tr>
<td>${escapeHtml(report.phaseId)}</td>
<td>${escapeHtml(report.executiveSummary ?? report.keyPoints[0] ?? "")}</td>
<td>${escapeHtml(String(report.evidenceReferences.length))}</td>
<td>${escapeHtml(String(report.recommendations.length))}</td>
</tr>`).join("\n");
  const rows = findings.map((finding) => `<tr class="finding-row" data-severity="${escapeHtml(finding.severity)}" data-status="${escapeHtml(finding.status ?? "open")}" data-feature="${escapeHtml(finding.featureId ?? "")}" data-search="${escapeHtml(searchTextForFinding(finding))}">
<td>${escapeHtml(finding.severity)}</td>
<td>${escapeHtml(finding.status ?? "open")}</td>
<td>${escapeHtml(finding.title)}</td>
<td>${escapeHtml(finding.paths.join(", ") || "n/a")}</td>
<td>${renderEvidenceLinks(finding)}</td>
<td>${escapeHtml(finding.recommendation ?? "")}</td>
</tr>`).join("\n");
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
</tr>`).join("\n") ?? "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RepoVista Findings</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #171717; line-height: 1.45; }
    header { border-bottom: 1px solid #d4d4d4; margin-bottom: 1.5rem; padding-bottom: 1rem; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; margin: 1rem 0; }
    .meta div { border: 1px solid #d4d4d4; padding: .75rem; border-radius: 6px; background: #fafafa; }
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .75rem; margin: 1rem 0; align-items: end; }
    label { display: grid; gap: .25rem; font-size: .9rem; font-weight: 600; }
    input, select { font: inherit; padding: .45rem .55rem; border: 1px solid #bdbdbd; border-radius: 6px; background: #fff; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d4d4d4; padding: .5rem; vertical-align: top; }
    th { background: #f5f5f5; text-align: left; }
    section { margin-top: 2rem; }
    li { margin-bottom: .75rem; }
    .muted { color: #666; }
    .hidden { display: none; }
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
      <div><strong>Total phase time</strong><br>${escapeHtml(analytics ? `${Math.round(analytics.totalDurationMs)}ms` : "not recorded")}</div>
    </div>
  </header>
  <section>
  <h2>Findings</h2>
  <div class="filters">
    <label>Search <input id="finding-search" type="search" placeholder="title, path, recommendation"></label>
    <label>Severity <select id="severity-filter">${severities.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select></label>
    <label>Status <select id="status-filter">${statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select></label>
    <label>Feature <select id="feature-filter">${features.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select></label>
  </div>
  <p class="muted" id="finding-count">${findings.length} finding(s)</p>
  <table>
    <thead><tr><th>Severity</th><th>Status</th><th>Title</th><th>Paths</th><th>Evidence</th><th>Recommendation</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=\"6\">No findings</td></tr>"}</tbody>
  </table>
  </section>
  <section>
  <h2>Run Analytics</h2>
  <table>
    <thead><tr><th>Phase</th><th>Status</th><th>Duration</th><th>Prompt Tokens</th></tr></thead>
    <tbody>${analyticsRows || "<tr><td colspan=\"4\">No analytics recorded.</td></tr>"}</tbody>
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

function renderEvidenceLinks(finding: StructuredFinding): string {
  const references = findingReferences(finding);
  if (!references.length) {
    return "n/a";
  }
  return references.map((reference) => {
    const line = reference.startLine ? `#L${reference.startLine}` : "";
    return `<a href="${escapeHtml(reference.path)}${line}">${escapeHtml(reference.path)}${reference.startLine ? `:${reference.startLine}` : ""}</a>`;
  }).join("<br>");
}

function searchTextForFinding(finding: StructuredFinding): string {
  return [
    finding.title,
    finding.severity,
    finding.status,
    finding.category,
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
