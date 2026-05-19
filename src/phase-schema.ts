import { extractFindings, extractJsonObjectCandidates } from "./findings.js";
import type { StructuredPhaseReport, StructuredRoadmapProposal } from "./types.js";

export function extractStructuredPhaseReport(markdown: string, phaseId: string, source: string): StructuredPhaseReport {
  const warnings: string[] = [];
  const candidates = extractJsonObjectCandidates(markdown)
    .map((block) => parseJsonObject(block))
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const schema = candidates.find((candidate) => candidate.phaseId === phaseId && isPhaseSchemaCandidate(candidate, phaseId) && !Array.isArray(candidate.findings)) ??
    candidates.find((candidate) => candidate.phaseId === phaseId) ??
    candidates.find((candidate) => candidate.schemaVersion === 1 && isPhaseSchemaCandidate(candidate, phaseId));

  if (!schema) {
    warnings.push("Structured phase schema was not found.");
    return fallbackPhaseReport(markdown, phaseId, source, warnings);
  }

  const report: StructuredPhaseReport = {
    schemaVersion: 1,
    phaseId,
    source,
    executiveSummary: readString(schema.executiveSummary),
    keyPoints: readStringArray(schema.keyPoints),
    evidenceReferences: readStringArray(schema.evidenceReferences),
    recommendations: readStringArray(schema.recommendations),
    warnings
  };

  if (phaseId === "feature-roadmap") {
    report.proposals = readProposalArray(schema.proposals);
  }
  if (phaseId === "risk-and-bug") {
    report.findings = extractFindings(markdown);
  }
  if (!report.keyPoints.length && !report.executiveSummary) {
    warnings.push("Structured phase schema is missing executiveSummary or keyPoints.");
  }
  warnings.push(...validateStructuredPhaseReport(report));
  return report;
}

export function hasStructuredPhaseSchema(markdown: string, phaseId: string): boolean {
  return !extractStructuredPhaseReport(markdown, phaseId, "inline").warnings.some((warning) => /not found/i.test(warning));
}

function fallbackPhaseReport(markdown: string, phaseId: string, source: string, warnings: string[]): StructuredPhaseReport {
  return {
    schemaVersion: 1,
    phaseId,
    source,
    executiveSummary: firstParagraph(markdown),
    keyPoints: extractBullets(markdown).slice(0, 12),
    evidenceReferences: Array.from(pathEvidence(markdown)).slice(0, 40),
    recommendations: extractRecommendations(markdown).slice(0, 12),
    warnings
  };
}

function isPhaseSchemaCandidate(value: Record<string, unknown>, phaseId: string): boolean {
  if (typeof value.phaseId === "string") {
    return value.phaseId === phaseId;
  }
  if (phaseId === "feature-roadmap" && Array.isArray(value.proposals)) {
    return true;
  }
  return Array.isArray(value.keyPoints) || Array.isArray(value.recommendations);
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
}

function readProposalArray(value: unknown): StructuredRoadmapProposal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : undefined)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      title: readString(item.title) ?? "Untitled proposal",
      description: readString(item.description) ?? "",
      evidence: readStringArray(item.evidence),
      benefit: readString(item.benefit) ?? "",
      effort: readString(item.effort) ?? "",
      risk: readString(item.risk) ?? "",
      affected: readStringArray(item.affected),
      steps: readStringArray(item.steps),
      priority: readString(item.priority) ?? "",
      confidence: readString(item.confidence) ?? ""
    }));
}

function validateStructuredPhaseReport(report: StructuredPhaseReport): string[] {
  const warnings: string[] = [];
  if (!report.evidenceReferences.length && report.phaseId !== "summary") {
    warnings.push("Structured phase schema is missing evidenceReferences.");
  }
  if (!report.recommendations.length && report.phaseId !== "summary") {
    warnings.push("Structured phase schema is missing recommendations.");
  }
  if (report.phaseId === "feature-roadmap") {
    const proposals = report.proposals ?? [];
    if (!proposals.length) {
      warnings.push("Structured roadmap schema is missing proposals.");
    }
    proposals.forEach((proposal, index) => {
      for (const [field, value] of Object.entries(proposal)) {
        const present = Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
        if (!present) {
          warnings.push(`Structured roadmap proposal ${index + 1} is missing ${field}.`);
        }
      }
    });
  }
  if (report.phaseId === "risk-and-bug" && report.findings?.some((finding) => !finding.signature)) {
    warnings.push("One or more structured findings are missing stable signatures.");
  }
  return warnings;
}

function firstParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s+.+$/gm, "").trim())
    .find(Boolean);
}

function extractBullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^\s*[-*]\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function extractRecommendations(markdown: string): string[] {
  return extractBullets(markdown).filter((line) => /recommend|should|add|improve|fix|refactor/i.test(line));
}

function pathEvidence(markdown: string): Set<string> {
  const matches = new Set<string>();
  const pathPattern = /(?:^|[\s`])((?:\.?\/)?(?:src|test|tests|lib|app|scripts|docs|\.github)[/\w.-]*|(?:package(?:-lock)?\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod))(?=$|[\s`)\],.;:])/gm;
  for (const match of markdown.matchAll(pathPattern)) {
    const normalized = match[1].replace(/^\.\//, "").replace(/\/+$/g, "");
    if (normalized) {
      matches.add(normalized);
    }
  }
  return matches;
}
