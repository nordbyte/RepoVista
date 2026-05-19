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
  const phaseRows = (context.structuredReports ?? []).map((report) => `<tr>
<td>${escapeHtml(report.phaseId)}</td>
<td>${escapeHtml(report.executiveSummary ?? report.keyPoints[0] ?? "")}</td>
<td>${escapeHtml(String(report.evidenceReferences.length))}</td>
<td>${escapeHtml(String(report.recommendations.length))}</td>
</tr>`).join("\n");
  const rows = findings.map((finding) => `<tr>
<td>${escapeHtml(finding.severity)}</td>
<td>${escapeHtml(finding.status ?? "open")}</td>
<td>${escapeHtml(finding.title)}</td>
<td>${escapeHtml(finding.paths.join(", ") || "n/a")}</td>
<td>${escapeHtml(finding.recommendation ?? "")}</td>
</tr>`).join("\n");
  const proposals = (context.structuredReports ?? [])
    .flatMap((report) => report.proposals ?? [])
    .map((proposal) => `<li><strong>${escapeHtml(proposal.title)}</strong><br>${escapeHtml(proposal.description)}<br><small>${escapeHtml(proposal.priority)} priority, ${escapeHtml(proposal.effort)} effort, ${escapeHtml(proposal.confidence)} confidence</small></li>`)
    .join("\n");
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
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d4d4d4; padding: .5rem; vertical-align: top; }
    th { background: #f5f5f5; text-align: left; }
    section { margin-top: 2rem; }
    li { margin-bottom: .75rem; }
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
    </div>
  </header>
  <section>
  <h2>Findings</h2>
  <table>
    <thead><tr><th>Severity</th><th>Status</th><th>Title</th><th>Paths</th><th>Recommendation</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=\"5\">No findings</td></tr>"}</tbody>
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
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
