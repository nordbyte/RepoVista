import type { StructuredFinding, StructuredRoadmapProposal } from "./types.js";

const evidenceReferenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "startLine", "endLine", "quote", "symbol"],
  properties: {
    path: { type: "string" },
    startLine: { type: ["number", "null"] },
    endLine: { type: ["number", "null"] },
    quote: { type: ["string", "null"] },
    symbol: { type: ["string", "null"] }
  }
};

const childFindingJsonSchema = {
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
    "confidence",
    "findingType",
    "parentId",
    "parentTitle"
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
      items: evidenceReferenceJsonSchema
    },
    problemRationale: { type: "string" },
    recommendedFix: { type: "string" },
    reproduction: { type: "string" },
    suggestedRegressionTest: { type: "string" },
    minimumFixScope: { type: "string" },
    estimatedEffort: { type: "string", enum: ["small", "medium", "large"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    findingType: { type: "string", enum: ["atomic"] },
    parentId: { type: ["string", "null"] },
    parentTitle: { type: ["string", "null"] }
  }
};

export const riskReportJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "phaseId", "executiveSummary", "severitySummary", "findings", "recommendations", "inspected"],
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
          "confidence",
          "findingType",
          "parentId",
          "parentTitle",
          "childFindings"
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
            items: evidenceReferenceJsonSchema
          },
          problemRationale: { type: "string" },
          recommendedFix: { type: "string" },
          reproduction: { type: "string" },
          suggestedRegressionTest: { type: "string" },
          minimumFixScope: { type: "string" },
          estimatedEffort: { type: "string", enum: ["small", "medium", "large"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          findingType: { type: "string", enum: ["atomic", "theme"] },
          parentId: { type: ["string", "null"] },
          parentTitle: { type: ["string", "null"] },
          childFindings: {
            type: "array",
            items: childFindingJsonSchema
          }
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

const PHASE_IDS = ["architecture", "code-quality", "feature-roadmap", "summary"] as const;

export const phaseReportJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "phaseId", "title", "executiveSummary", "sections", "keyPoints", "evidenceReferences", "recommendations", "proposals"],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    phaseId: { type: "string", enum: [...PHASE_IDS] },
    title: { type: "string" },
    executiveSummary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body", "bullets"],
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          bullets: { type: "array", items: { type: "string" } }
        }
      }
    },
    keyPoints: { type: "array", items: { type: "string" } },
    evidenceReferences: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "evidence", "benefit", "effort", "risk", "affected", "steps", "priority", "confidence"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          benefit: { type: "string" },
          effort: { type: "string" },
          risk: { type: "string" },
          affected: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          priority: { type: "string" },
          confidence: { type: "string" }
        }
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

export function schemaForPhase(phaseId: string): { kind: "risk-report" | "phase-report"; schema: Record<string, unknown> } | undefined {
  if (phaseId === "risk-and-bug") {
    return { kind: "risk-report", schema: riskReportJsonSchema };
  }
  if ((PHASE_IDS as readonly string[]).includes(phaseId)) {
    return { kind: "phase-report", schema: phaseReportJsonSchema };
  }
  return undefined;
}

export function structuredPromptForPhase(phaseId: string, prompt: string): string {
  if (phaseId === "risk-and-bug") {
    return `${prompt}

Additional structured-output rule:
- Return strict JSON only. No Markdown, no code fences.
- The JSON must match RepoVista's provider-native risk-report schema.
- Put all concrete risk findings in the "findings" array.
- If no findings are supported by concrete evidence, return "findings": [] and explain the empty result in severitySummary and executiveSummary.
`;
  }

  return `${prompt}

Additional structured-output rule:
- Return strict JSON only. No Markdown, no code fences.
- The JSON must match RepoVista's provider-native phase-report schema.
- Set "phaseId" to "${phaseId}".
- Put the requested Markdown section content into "sections" as ordered heading/body/bullets objects. Use an empty bullets array when a section has no bullet list.
- Put the most important evidence-backed points in "keyPoints".
- Put concrete repository path references in "evidenceReferences".
- Put actionable recommendations in "recommendations".
- For feature-roadmap, include at least 6 complete "proposals" unless the repository genuinely cannot justify that many. For other phases, set "proposals" to [].
`;
}

export function renderStructuredProviderOutput(kind: string, rawJson: string): string {
  if (kind === "risk-report") {
    return renderRiskReport(JSON.parse(rawJson) as Record<string, unknown>);
  }
  if (kind === "phase-report") {
    return renderPhaseReport(JSON.parse(rawJson) as Record<string, unknown>);
  }
  if (kind === "fix-plan") {
    return renderFixPlan(JSON.parse(rawJson) as Record<string, unknown>);
  }
  if (kind === "revalidation") {
    return renderRevalidation(JSON.parse(rawJson) as Record<string, unknown>);
  }
  return rawJson;
}

function renderPhaseReport(parsed: Record<string, unknown>): string {
  const phaseId = stringValue(parsed.phaseId);
  const title = stringValue(parsed.title) || titleForPhase(phaseId);
  const sections = readSections(parsed.sections);
  const keyPoints = stringArray(parsed.keyPoints);
  const evidenceReferences = stringArray(parsed.evidenceReferences);
  const recommendations = stringArray(parsed.recommendations);
  const proposals = readProposals(parsed.proposals);
  const schemaBlock = {
    schemaVersion: 1,
    phaseId,
    executiveSummary: stringValue(parsed.executiveSummary),
    keyPoints,
    evidenceReferences,
    recommendations,
    ...(phaseId === "feature-roadmap" ? { proposals } : {})
  };

  return `# ${title}

## Executive Summary

${stringValue(parsed.executiveSummary) || "No executive summary was provided."}

${sections.map(renderSection).join("\n\n")}

${recommendations.length ? `## Recommendations\n\n${renderList(recommendations)}\n` : ""}
\`\`\`json
${JSON.stringify(schemaBlock, null, 2)}
\`\`\`
`;
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
${JSON.stringify(findingsSentinelPayload(findings), null, 2)}
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
    const childFindings = normalizeStructuredFindings(raw.childFindings)
      .map((child) => ({
        ...child,
        parentId: child.parentId || stringValue(raw.signature) || undefined,
        parentTitle: child.parentTitle || stringValue(raw.title) || undefined
      }));
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
      parentId: stringValue(raw.parentId),
      findingType: raw.findingType === "theme" ? "theme" : "atomic",
      parentTitle: stringValue(raw.parentTitle),
      childFindings,
      schemaVersion: 1
    };
  });
}

export function findingsSentinelPayload(findings: StructuredFinding[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    phaseId: "risk-and-bug",
    findings: findings.map(schemaFinding)
  };
}

function schemaFinding(finding: StructuredFinding): Record<string, unknown> {
  return {
    title: finding.title,
    severity: finding.severity === "unknown" ? "low" : finding.severity,
    category: finding.category ?? "unknown",
    status: finding.status ?? "open",
    signature: finding.signature ?? "",
    affectedPaths: finding.paths,
    evidence: finding.evidence ?? "",
    evidenceReferences: schemaEvidenceReferences(finding),
    problemRationale: finding.problemRationale ?? "",
    recommendedFix: finding.recommendation ?? "",
    reproduction: finding.reproduction ?? "",
    suggestedRegressionTest: finding.suggestedRegressionTest ?? "",
    minimumFixScope: finding.minimumFixScope ?? "",
    estimatedEffort: schemaEffort(finding.estimatedEffort),
    confidence: schemaConfidence(finding.confidence),
    findingType: finding.findingType ?? "atomic",
    parentId: finding.parentId ?? null,
    parentTitle: finding.parentTitle ?? null,
    childFindings: (finding.childFindings ?? []).map(schemaFinding)
  };
}

function schemaEvidenceReferences(finding: StructuredFinding): Array<Record<string, unknown>> {
  const references = finding.evidenceDetails?.length ? finding.evidenceDetails : finding.evidenceReferences ?? [];
  return references
    .map((reference) => typeof reference === "string" ? { path: reference } : reference)
    .filter((reference) => reference.path)
    .map((reference) => ({
      path: reference.path,
      startLine: reference.startLine ?? null,
      endLine: reference.endLine ?? null,
      quote: reference.quote ?? null,
      symbol: reference.symbol ?? null
    }));
}

function schemaEffort(value: string | undefined): "small" | "medium" | "large" {
  return value === "small" || value === "medium" || value === "large" ? value : "medium";
}

function schemaConfidence(value: string | undefined): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
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

function readSections(value: unknown): Array<{ heading: string; body: string; bullets: string[] }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      heading: stringValue(item.heading) || "Details",
      body: stringValue(item.body),
      bullets: stringArray(item.bullets)
    }))
    .filter((item) => item.body || item.bullets.length);
}

function renderSection(section: { heading: string; body: string; bullets: string[] }): string {
  const bullets = section.bullets.length ? `\n\n${renderList(section.bullets)}` : "";
  return `## ${section.heading}\n\n${section.body || "n/a"}${bullets}`;
}

function readProposals(value: unknown): StructuredRoadmapProposal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      title: stringValue(item.title) || "Untitled proposal",
      description: stringValue(item.description),
      evidence: stringArray(item.evidence),
      benefit: stringValue(item.benefit),
      effort: stringValue(item.effort),
      risk: stringValue(item.risk),
      affected: stringArray(item.affected),
      steps: stringArray(item.steps),
      priority: stringValue(item.priority),
      confidence: stringValue(item.confidence)
    }));
}

function titleForPhase(phaseId: string): string {
  if (phaseId === "architecture") {
    return "Architecture Analysis";
  }
  if (phaseId === "code-quality") {
    return "Code Quality Analysis";
  }
  if (phaseId === "feature-roadmap") {
    return "Feature and Improvement Roadmap";
  }
  if (phaseId === "summary") {
    return "Executive Summary";
  }
  return "RepoVista Report";
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
