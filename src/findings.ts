import { findingSignature, stableFindingId } from "./stable-id.js";
import type { FindingEvidenceReference, FindingStatus, StructuredFinding } from "./types.js";

export interface FindingExtractionResult {
  findings: StructuredFinding[];
  source: "schema" | "markdown";
  schemaFound: boolean;
  warnings: string[];
}

const SEVERITY_PATTERN = /\bseverity\s*:\s*(critical|high|medium|low)\b/i;
const CATEGORY_PATTERN = /\bcategory\s*:\s*([^\n]+)/i;
const CONFIDENCE_PATTERN = /\bconfidence\s*:\s*([^\n]+)/i;
const EVIDENCE_PATTERN = /\bevidence\s*:\s*([^\n]+)/i;
const RECOMMENDATION_PATTERN = /\b(?:recommended fix|recommendation|concrete fix proposal)\s*:\s*([^\n]+)/i;
const PROBLEM_RATIONALE_PATTERN = /\bproblem rationale\s*:\s*([^\n]+)/i;
const ESTIMATED_EFFORT_PATTERN = /\bestimated effort\s*:\s*([^\n]+)/i;
const PATH_FIELD_PATTERN = /\b(?:file|path|affected paths?|affected files?)\s*:\s*([^\n]+)/i;
const PATH_TOKEN_PATTERN = /`([^`]+)`|(?:^|[\s([:,])((?:\.?\/)?(?:(?:src|test|tests|lib|app|scripts|docs|\.github)\/[\w./-]+|(?:package(?:-lock)?\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod)))(?=$|[\s)\],.;:])/g;
const PATH_ROOTS = new Set(["src", "test", "tests", "lib", "app", "scripts", "docs", ".github"]);

export function extractFindings(report: string, source = "03-risk-and-bug-report.md"): StructuredFinding[] {
  return extractFindingsWithSource(report, source).findings;
}

export function extractFindingsWithSource(report: string, source = "03-risk-and-bug-report.md"): FindingExtractionResult {
  const schema = extractSchemaFindings(report, source);
  if (schema.schemaFound) {
    return schema;
  }

  return {
    findings: extractMarkdownFindings(report, source),
    source: "markdown",
    schemaFound: false,
    warnings: []
  };
}

export function extractSchemaFindings(report: string, source = "03-risk-and-bug-report.md"): FindingExtractionResult {
  const warnings: string[] = [];
  for (const block of jsonBlocks(report)) {
    const parsed = parseJsonObject(block);
    if (!parsed || !Array.isArray(parsed.findings)) {
      continue;
    }

    const schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : undefined;
    const findings = parsed.findings
      .map((item, index) => normalizeSchemaFinding(item, index, source, schemaVersion, warnings))
      .filter((item): item is StructuredFinding => Boolean(item));
    return {
      findings,
      source: "schema",
      schemaFound: true,
      warnings
    };
  }

  return {
    findings: [],
    source: "markdown",
    schemaFound: false,
    warnings
  };
}

function extractMarkdownFindings(report: string, source: string): StructuredFinding[] {
  const blocks = splitFindingBlocks(report);
  const findings: StructuredFinding[] = [];

  for (const block of blocks) {
    const severity = SEVERITY_PATTERN.exec(block)?.[1]?.toLowerCase() as StructuredFinding["severity"] | undefined;
    if (!severity) {
      continue;
    }

    const title = extractTitle(block) ?? `${capitalize(severity)} finding`;
    const paths = extractPaths(block);
    const evidence = cleanField(EVIDENCE_PATTERN.exec(block)?.[1]);
    const evidenceReferences = extractPaths(evidence ?? "");
    findings.push(withStableFindingIdentity({
      id: "",
      source,
      title,
      severity,
      category: cleanField(CATEGORY_PATTERN.exec(block)?.[1]),
      status: "open",
      triage: triageFor(cleanField(CATEGORY_PATTERN.exec(block)?.[1]), severity, cleanField(CONFIDENCE_PATTERN.exec(block)?.[1])),
      paths,
      evidence,
      evidenceReferences,
      evidenceDetails: evidenceReferences.map((reference) => ({ path: reference })),
      recommendation: cleanField(RECOMMENDATION_PATTERN.exec(block)?.[1]),
      problemRationale: cleanField(PROBLEM_RATIONALE_PATTERN.exec(block)?.[1]),
      estimatedEffort: cleanField(ESTIMATED_EFFORT_PATTERN.exec(block)?.[1]),
      confidence: cleanField(CONFIDENCE_PATTERN.exec(block)?.[1])
    }));
  }

  return findings;
}

function normalizeSchemaFinding(
  item: unknown,
  index: number,
  source: string,
  schemaVersion: number | undefined,
  warnings: string[]
): StructuredFinding | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    warnings.push(`Finding ${index + 1} is not an object.`);
    return undefined;
  }

  const record = item as Record<string, unknown>;
  const title = readString(record.title);
  const severity = normalizeSeverity(readString(record.severity));
  if (!title) {
    warnings.push(`Finding ${index + 1} is missing title.`);
  }
  if (severity === "unknown") {
    warnings.push(`Finding ${index + 1} has an unknown severity.`);
  }

  const paths = readPathArray(record.affectedPaths ?? record.paths ?? record.affectedFiles);
  const evidenceDetails = readEvidenceReferences(record.evidenceReferences ?? record.evidenceDetails ?? record.evidencePaths ?? record.references);
  const evidenceReferences = evidenceDetails.map((reference) => reference.path);
  const category = readString(record.category);
  const confidence = readString(record.confidence);
  const normalized: StructuredFinding = {
    id: readString(record.id) ?? "",
    source,
    title: title ?? `${capitalize(severity)} finding`,
    severity,
    category,
    status: normalizeStatus(readString(record.status)) ?? "open",
    triage: readString(record.triage) ?? triageFor(category, severity, confidence),
    paths,
    evidence: readString(record.evidence),
    evidenceReferences: evidenceReferences.length ? evidenceReferences : extractPaths(readString(record.evidence) ?? ""),
    evidenceDetails: evidenceDetails.length
      ? evidenceDetails
      : extractPaths(readString(record.evidence) ?? "").map((reference) => ({ path: reference })),
    recommendation: readString(record.recommendedFix ?? record.recommendation),
    problemRationale: readString(record.problemRationale ?? record.rationale),
    estimatedEffort: readString(record.estimatedEffort ?? record.effort),
    confidence,
    schemaVersion
  };

  return withStableFindingIdentity(normalized);
}

function jsonBlocks(report: string): string[] {
  const blocks: string[] = [];
  const fencePattern = /```[ \t]*(?:json|repovista-findings)?[^\n]*\n([\s\S]*?)```/gi;
  for (const match of report.matchAll(fencePattern)) {
    blocks.push(match[1]);
  }
  return blocks;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Non-schema JSON blocks are ignored.
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readPathArray(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitPathField(value)
      : [];
  const paths = new Set<string>();
  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") {
      continue;
    }
    const normalized = normalizePathCandidate(rawValue, true);
    if (normalized) {
      paths.add(normalized);
    }
  }
  return Array.from(paths).sort();
}

function readEvidenceReferences(value: unknown): FindingEvidenceReference[] {
  const references: FindingEvidenceReference[] = [];
  const seen = new Set<string>();
  const values = Array.isArray(value) ? value : typeof value === "string" ? splitPathField(value) : [];
  for (const item of values) {
    const reference = readEvidenceReference(item);
    if (!reference) {
      continue;
    }
    const key = `${reference.path}:${reference.startLine ?? ""}:${reference.endLine ?? ""}:${reference.quote ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push(reference);
    }
  }
  return references.sort((left, right) => left.path.localeCompare(right.path) || (left.startLine ?? 0) - (right.startLine ?? 0));
}

function readEvidenceReference(value: unknown): FindingEvidenceReference | undefined {
  if (typeof value === "string") {
    const pathValue = normalizePathCandidate(value, true);
    return pathValue ? { path: pathValue } : undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const pathValue = normalizePathCandidate(readString(record.path ?? record.file ?? record.relativePath), true);
  if (!pathValue) {
    return undefined;
  }

  const startLine = readPositiveInteger(record.startLine ?? record.line ?? record.lineStart);
  const endLine = readPositiveInteger(record.endLine ?? record.lineEnd) ?? startLine;
  return {
    path: pathValue,
    startLine,
    endLine,
    quote: readString(record.quote ?? record.snippet),
    symbol: readString(record.symbol)
  };
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

function normalizeSeverity(value: string | undefined): StructuredFinding["severity"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "unknown";
}

function normalizeStatus(value: string | undefined): FindingStatus | undefined {
  const normalized = value?.toLowerCase();
  if (normalized === "open" || normalized === "fixed" || normalized === "false-positive" || normalized === "wont-fix" || normalized === "uncertain") {
    return normalized;
  }
  return undefined;
}

function withStableFindingIdentity(finding: StructuredFinding): StructuredFinding {
  const signature = findingSignature(finding);
  const id = finding.id && finding.id.startsWith("fnd_") ? finding.id : stableFindingId(finding);
  return {
    ...finding,
    id,
    signature,
    status: finding.status ?? "open",
    triage: finding.triage ?? triageFor(finding.category, finding.severity, finding.confidence)
  };
}

function triageFor(category: string | undefined, severity: StructuredFinding["severity"], confidence: string | undefined): string {
  const normalizedCategory = category?.toLowerCase() ?? "";
  const normalizedConfidence = confidence?.toLowerCase() ?? "";
  if (severity === "critical" || severity === "high") {
    return normalizedConfidence === "low" ? "needs-confirmation" : "needs-fix";
  }
  if (/security|auth|secret|injection|path|data loss/.test(normalizedCategory)) {
    return "needs-fix";
  }
  if (/test|coverage|docs?/.test(normalizedCategory)) {
    return "improvement";
  }
  return "review";
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
  const titleFieldBlocks = splitTitleFieldBlocks(lines);
  if (titleFieldBlocks.length) {
    return titleFieldBlocks;
  }

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

function splitTitleFieldBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const startsTitleBlock = /^\s*(?:[-*]\s+)?title\s*:/i.test(line);
    if (startsTitleBlock && current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }
    if (startsTitleBlock || current.length) {
      current.push(line);
    }
  }

  if (current.length) {
    blocks.push(current.join("\n"));
  }

  return blocks.filter((block) => SEVERITY_PATTERN.test(block));
}

function extractTitle(block: string): string | undefined {
  for (const line of block.split(/\r?\n/)) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading && !/findings?$/i.test(heading.trim())) {
      return cleanTitle(heading);
    }

    const titleField = /\btitle\s*:\s*(.+)$/i.exec(line)?.[1];
    if (titleField) {
      return cleanTitle(titleField);
    }

    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line)?.[1];
    if (bullet && !SEVERITY_PATTERN.test(bullet)) {
      return cleanTitle(bullet);
    }
  }

  return undefined;
}

function extractPaths(block: string): string[] {
  const explicit = PATH_FIELD_PATTERN.exec(block)?.[1];
  const values = new Set<string>();

  if (explicit) {
    for (const candidate of splitPathField(explicit)) {
      const normalized = normalizePathCandidate(candidate, true);
      if (normalized) {
        values.add(normalized);
      }
    }
  }

  if (!values.size) {
    for (const match of block.matchAll(PATH_TOKEN_PATTERN)) {
      const normalized = normalizePathCandidate(match[1] ?? match[2], false);
      if (normalized) {
        values.add(normalized);
      }
    }
  }

  return Array.from(values).filter(Boolean).sort();
}

function cleanField(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^\s*[-*]\s*/, "").trim();
  return cleaned ? stripPunctuation(cleaned) : undefined;
}

function cleanTitle(value: string): string {
  return stripPunctuation(value.replace(/^\s*title\s*:\s*/i, "").replace(/\bseverity\s*:.+$/i, "").trim()) || "Untitled finding";
}

function stripPunctuation(value: string): string {
  return value.replace(/[.,;:)\]]+$/g, "").replace(/^`|`$/g, "").trim();
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function splitPathField(value: string): string[] {
  return value
    .split(/,|;|\s+and\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathCandidate(value: string | undefined, allowRootDirectory: boolean): string | undefined {
  const stripped = stripPunctuation((value ?? "")
    .replace(/^['"`(]+|['"`)\]]+$/g, "")
    .replace(/^\.\//, "")
    .trim());
  if (!stripped || /\s/.test(stripped) || stripped.includes("..")) {
    return undefined;
  }

  const normalized = stripped.replace(/\\/g, "/").replace(/\/+$/g, "");
  const firstSegment = normalized.split("/")[0];
  if (PATH_ROOTS.has(firstSegment)) {
    if (normalized.includes("/") || allowRootDirectory) {
      return normalized;
    }
    return undefined;
  }

  if (/^(?:package(?:-lock)?\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/.test(normalized)) {
    return normalized;
  }

  return undefined;
}
