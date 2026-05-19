import type { StructuredFinding } from "./types.js";

export const riskReportJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "phaseId", "executiveSummary", "findings", "recommendations", "inspected"],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    phaseId: { type: "string", enum: ["risk-and-bug"] },
    executiveSummary: { type: "string" },
    severitySummary: {
      type: "object",
      additionalProperties: false,
      required: ["critical", "high", "medium", "low"],
      properties: {
        critical: { type: "string" },
        high: { type: "string" },
        medium: { type: "string" },
        low: { type: "string" }
      }
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "severity",
          "category",
          "status",
          "signature",
          "affectedPaths",
          "evidence",
          "evidenceReferences",
          "problemRationale",
          "recommendedFix",
          "reproduction",
          "suggestedRegressionTest",
          "minimumFixScope",
          "estimatedEffort",
          "confidence"
        ],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          category: { type: "string" },
          status: { type: "string", enum: ["open", "fixed", "false-positive", "wont-fix", "uncertain"] },
          signature: { type: "string" },
          affectedPaths: { type: "array", items: { type: "string" } },
          evidence: { type: "string" },
          evidenceReferences: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path"],
              properties: {
                path: { type: "string" },
                startLine: { type: ["number", "null"] },
                endLine: { type: ["number", "null"] },
                quote: { type: ["string", "null"] },
                symbol: { type: ["string", "null"] }
              }
            }
          },
          problemRationale: { type: "string" },
          recommendedFix: { type: "string" },
          reproduction: { type: "string" },
          suggestedRegressionTest: { type: "string" },
          minimumFixScope: { type: "string" },
          estimatedEffort: { type: "string", enum: ["small", "medium", "large"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          findingType: { type: "string", enum: ["atomic", "theme"] },
          parentTitle: { type: ["string", "null"] }
        }
      }
    },
    recommendations: { type: "array", items: { type: "string" } },
    inspected: {
      type: "object",
      additionalProperties: false,
      required: ["files", "symbols", "notes"],
      properties: {
        files: { type: "array", items: { type: "string" } },
        symbols: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } }
      }
    }
  }
};

export const fixPlanJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "summary", "steps", "filesToChange", "validationCommands", "risk"],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    summary: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    filesToChange: { type: "array", items: { type: "string" } },
    validationCommands: { type: "array", items: { type: "string" } },
    risk: { type: "string" }
  }
};

export const revalidationJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "status", "reasoning", "evidenceReferences"],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    status: { type: "string", enum: ["open", "fixed", "false-positive", "uncertain"] },
    reasoning: { type: "string" },
    evidenceReferences: { type: "array", items: { type: "string" } }
  }
};

export function schemaForPhase(phaseId: string): { kind: "risk-report"; schema: Record<string, unknown> } | undefined {
  return phaseId === "risk-and-bug"
    ? { kind: "risk-report", schema: riskReportJsonSchema }
    : undefined;
}

export function structuredRiskPrompt(prompt: string): string {
  return `${prompt}

Additional structured-output rule:
- Return strict JSON only. No Markdown, no code fences.
- The JSON must match RepoVista's provider-native risk-report schema.
- Put all concrete risk findings in the "findings" array.
- If no findings are supported by concrete evidence, return "findings": [] and explain the empty result in severitySummary and executiveSummary.
`;
}

export function renderStructuredProviderOutput(kind: string, rawJson: string): string {
  if (kind === "risk-report") {
    return renderRiskReport(JSON.parse(rawJson) as Record<string, unknown>);
  }
  if (kind === "fix-plan") {
    return renderFixPlan(JSON.parse(rawJson) as Record<string, unknown>);
  }
  if (kind === "revalidation") {
    return renderRevalidation(JSON.parse(rawJson) as Record<string, unknown>);
  }
  return rawJson;
}

function renderRiskReport(parsed: Record<string, unknown>): string {
  const findings = normalizeStructuredFindings(parsed.findings);
  const severitySummary = typeof parsed.severitySummary === "object" && parsed.severitySummary
    ? parsed.severitySummary as Record<string, unknown>
    : {};
  const recommendations = stringArray(parsed.recommendations);
  const inspected = typeof parsed.inspected === "object" && parsed.inspected
    ? parsed.inspected as Record<string, unknown>
    : {};
  return `# Risk and Bug Analysis

## Executive Summary

${stringValue(parsed.executiveSummary) || "No executive summary was provided."}

## Critical Findings

${severitySection(findings, "critical", stringValue(severitySummary.critical))}

## High Findings

${severitySection(findings, "high", stringValue(severitySummary.high))}

## Medium Findings

${severitySection(findings, "medium", stringValue(severitySummary.medium))}

## Low Findings

${severitySection(findings, "low", stringValue(severitySummary.low))}

## Inspected Context

- Files: ${stringArray(inspected.files).join(", ") || "n/a"}
- Symbols: ${stringArray(inspected.symbols).join(", ") || "n/a"}
- Notes: ${stringArray(inspected.notes).join("; ") || "n/a"}

## Recommended Next Steps

${recommendations.length ? recommendations.map((item) => `- ${item}`).join("\n") : "- Keep the current evidence pack and automated checks current."}

<!-- repovista-findings:start -->
${JSON.stringify({
    schemaVersion: 1,
    phaseId: "risk-and-bug",
    findings
  }, null, 2)}
<!-- repovista-findings:end -->
`;
}

function renderFixPlan(parsed: Record<string, unknown>): string {
  return `# RepoVista Fix Plan

## Summary

${stringValue(parsed.summary)}

## Steps

${renderList(stringArray(parsed.steps))}

## Files To Change

${renderList(stringArray(parsed.filesToChange))}

## Validation Commands

${renderList(stringArray(parsed.validationCommands))}

## Risk

${stringValue(parsed.risk)}
`;
}

function renderRevalidation(parsed: Record<string, unknown>): string {
  return `# RepoVista Finding Revalidation

Status: ${stringValue(parsed.status) || "uncertain"}

Reasoning: ${stringValue(parsed.reasoning)}

Evidence references:
${renderList(stringArray(parsed.evidenceReferences))}
`;
}

function severitySection(findings: StructuredFinding[], severity: StructuredFinding["severity"], fallback: string): string {
  const selected = findings.filter((finding) => finding.severity === severity);
  if (!selected.length) {
    return fallback || `No ${severity} findings were detected.`;
  }
  return selected.map((finding) => [
    `- Title: ${finding.title}`,
    `  Severity: ${finding.severity}`,
    `  Category: ${finding.category ?? "n/a"}`,
    `  Affected paths: ${finding.paths.join(", ") || "n/a"}`,
    `  Evidence: ${finding.evidence ?? "n/a"}`,
    `  Problem rationale: ${finding.problemRationale ?? "n/a"}`,
    `  Recommended fix: ${finding.recommendation ?? "n/a"}`,
    `  Reproduction: ${finding.reproduction ?? "n/a"}`,
    `  Suggested regression test: ${finding.suggestedRegressionTest ?? "n/a"}`,
    `  Minimum fix scope: ${finding.minimumFixScope ?? "n/a"}`,
    `  Confidence: ${finding.confidence ?? "n/a"}`
  ].join("\n")).join("\n");
}

function normalizeStructuredFindings(value: unknown): StructuredFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => {
    const raw = typeof item === "object" && item ? item as Record<string, unknown> : {};
    const paths = stringArray(raw.affectedPaths);
    return {
      id: "",
      source: "provider-native-json",
      title: stringValue(raw.title) || `Structured finding ${index + 1}`,
      severity: severityValue(raw.severity),
      category: stringValue(raw.category),
      status: statusValue(raw.status),
      signature: stringValue(raw.signature),
      paths,
      evidence: stringValue(raw.evidence),
      evidenceReferences: evidenceRefs(raw.evidenceReferences),
      problemRationale: stringValue(raw.problemRationale),
      recommendation: stringValue(raw.recommendedFix),
      reproduction: stringValue(raw.reproduction),
      suggestedRegressionTest: stringValue(raw.suggestedRegressionTest),
      minimumFixScope: stringValue(raw.minimumFixScope),
      estimatedEffort: stringValue(raw.estimatedEffort),
      confidence: stringValue(raw.confidence),
      findingType: raw.findingType === "theme" ? "theme" : "atomic",
      parentTitle: stringValue(raw.parentTitle),
      schemaVersion: 1
    };
  });
}

function evidenceRefs(value: unknown): StructuredFinding["evidenceReferences"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      path: stringValue(item.path),
      startLine: numberValue(item.startLine),
      endLine: numberValue(item.endLine),
      quote: stringValue(item.quote),
      symbol: stringValue(item.symbol)
    }))
    .filter((item) => item.path);
}

function renderList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- n/a";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function severityValue(value: unknown): StructuredFinding["severity"] {
  return value === "critical" || value === "high" || value === "medium" || value === "low" ? value : "unknown";
}

function statusValue(value: unknown): StructuredFinding["status"] {
  return value === "open" || value === "fixed" || value === "false-positive" || value === "wont-fix" || value === "uncertain"
    ? value
    : "open";
}
