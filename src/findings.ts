import type { StructuredFinding } from "./types.js";

const SEVERITY_PATTERN = /\bseverity\s*:\s*(critical|high|medium|low)\b/i;
const CATEGORY_PATTERN = /\bcategory\s*:\s*([^\n]+)/i;
const CONFIDENCE_PATTERN = /\bconfidence\s*:\s*([^\n]+)/i;
const EVIDENCE_PATTERN = /\bevidence\s*:\s*([^\n]+)/i;
const RECOMMENDATION_PATTERN = /\b(?:recommended fix|recommendation|concrete fix proposal)\s*:\s*([^\n]+)/i;
const PATH_FIELD_PATTERN = /\b(?:file|path|affected paths?|affected files?)\s*:\s*([^\n]+)/i;
const PATH_PATTERN = /(?:\.?\/)?(?:src|test|tests|lib|app|scripts|docs|\.github|package\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod)[/\w.-]*/g;

export function extractFindings(report: string, source = "03-risk-and-bug-report.md"): StructuredFinding[] {
  const blocks = splitFindingBlocks(report);
  const findings: StructuredFinding[] = [];

  for (const block of blocks) {
    const severity = SEVERITY_PATTERN.exec(block)?.[1]?.toLowerCase() as StructuredFinding["severity"] | undefined;
    if (!severity) {
      continue;
    }

    const title = extractTitle(block) ?? `${capitalize(severity)} finding`;
    findings.push({
      id: `finding-${String(findings.length + 1).padStart(3, "0")}`,
      source,
      title,
      severity,
      category: cleanField(CATEGORY_PATTERN.exec(block)?.[1]),
      paths: extractPaths(block),
      evidence: cleanField(EVIDENCE_PATTERN.exec(block)?.[1]),
      recommendation: cleanField(RECOMMENDATION_PATTERN.exec(block)?.[1]),
      confidence: cleanField(CONFIDENCE_PATTERN.exec(block)?.[1])
    });
  }

  return findings;
}

export function findingCountsBySeverity(findings: StructuredFinding[]): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0
  };
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}

function splitFindingBlocks(report: string): string[] {
  const lines = report.split(/\r?\n/);
  const headingBlocks: string[] = [];
  let headingBlock: string[] = [];

  for (const line of lines) {
    if (/^#{3,6}\s+/.test(line) && headingBlock.length) {
      headingBlocks.push(headingBlock.join("\n"));
      headingBlock = [];
    }
    headingBlock.push(line);
  }

  if (headingBlock.length) {
    headingBlocks.push(headingBlock.join("\n"));
  }

  const structuredHeadingBlocks = headingBlocks.filter((block) => SEVERITY_PATTERN.test(block));
  if (structuredHeadingBlocks.length) {
    return structuredHeadingBlocks;
  }

  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const startsBlock = /^#{2,6}\s+/.test(line) || /^\s*(?:[-*]|\d+\.)\s+/.test(line);
    if (startsBlock && current.length && current.some((item) => SEVERITY_PATTERN.test(item))) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }

  if (current.length) {
    blocks.push(current.join("\n"));
  }

  return blocks;
}

function extractTitle(block: string): string | undefined {
  for (const line of block.split(/\r?\n/)) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading && !/findings?$/i.test(heading.trim())) {
      return cleanTitle(heading);
    }

    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line)?.[1];
    if (bullet && !SEVERITY_PATTERN.test(bullet)) {
      return cleanTitle(bullet);
    }

    const titleField = /\btitle\s*:\s*(.+)$/i.exec(line)?.[1];
    if (titleField) {
      return cleanTitle(titleField);
    }
  }

  return undefined;
}

function extractPaths(block: string): string[] {
  const explicit = PATH_FIELD_PATTERN.exec(block)?.[1];
  const values = new Set<string>();
  for (const source of [explicit, block]) {
    if (!source) {
      continue;
    }
    for (const match of source.matchAll(PATH_PATTERN)) {
      values.add(stripPunctuation(match[0]));
    }
  }
  return Array.from(values).filter(Boolean).sort();
}

function cleanField(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^\s*[-*]\s*/, "").trim();
  return cleaned ? stripPunctuation(cleaned) : undefined;
}

function cleanTitle(value: string): string {
  return stripPunctuation(value.replace(/\bseverity\s*:.+$/i, "").trim()) || "Untitled finding";
}

function stripPunctuation(value: string): string {
  return value.replace(/[.,;:)\]]+$/g, "").replace(/^`|`$/g, "").trim();
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
