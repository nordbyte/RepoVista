import { writeFile } from "node:fs/promises";
import { reportPath } from "./reports.js";
import type { FindingEvidenceReference, ReportExportFormat, RunPaths, StructuredFinding } from "./types.js";

export interface FindingExportPaths {
  findingsSarif?: string;
  findingsJsonl?: string;
  htmlReport?: string;
  githubAnnotationsJson?: string;
}

export async function writeFindingExports(
  paths: RunPaths,
  findings: StructuredFinding[],
  formats: ReportExportFormat[]
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
    await writeFile(outputs.htmlReport, renderHtml(findings), "utf8");
  }

  if (uniqueFormats.has("github")) {
    outputs.githubAnnotationsJson = reportPath(paths.runDir, "github-annotations.json");
    await writeFile(outputs.githubAnnotationsJson, `${JSON.stringify(toGithubAnnotations(findings), null, 2)}\n`, "utf8");
  }

  return outputs;
}

function toSarif(findings: StructuredFinding[]): Record<string, unknown> {
  const rules = new Map(findings.map((finding) => [finding.id, {
    id: finding.id,
    name: finding.title,
    shortDescription: { text: finding.title },
    fullDescription: { text: finding.problemRationale ?? finding.evidence ?? finding.title },
    help: { text: finding.recommendation ?? "Review the RepoVista finding." },
    properties: {
      severity: finding.severity,
      category: finding.category,
      confidence: finding.confidence
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
          ruleId: finding.id,
          level: sarifLevel(finding.severity),
          message: { text: finding.evidence ?? finding.title },
          locations: findingLocations(finding)
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
      raw_details: finding.problemRationale
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
  return finding.evidenceDetails?.length
    ? finding.evidenceDetails
    : finding.paths.map((path) => ({ path }));
}

function renderHtml(findings: StructuredFinding[]): string {
  const rows = findings.map((finding) => `<tr>
<td>${escapeHtml(finding.severity)}</td>
<td>${escapeHtml(finding.status ?? "open")}</td>
<td>${escapeHtml(finding.title)}</td>
<td>${escapeHtml(finding.paths.join(", ") || "n/a")}</td>
<td>${escapeHtml(finding.recommendation ?? "")}</td>
</tr>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RepoVista Findings</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #171717; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d4d4d4; padding: .5rem; vertical-align: top; }
    th { background: #f5f5f5; text-align: left; }
  </style>
</head>
<body>
  <h1>RepoVista Findings</h1>
  <table>
    <thead><tr><th>Severity</th><th>Status</th><th>Title</th><th>Paths</th><th>Recommendation</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=\"5\">No findings</td></tr>"}</tbody>
  </table>
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
