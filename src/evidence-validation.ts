import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  FindingEvidenceReference,
  FindingEvidenceValidation,
  FindingEvidenceValidationReference,
  StructuredFinding
} from "./types.js";

export async function validateFindingsEvidence(
  projectRoot: string,
  findings: StructuredFinding[],
  allowedPaths?: Set<string>,
  now = new Date()
): Promise<StructuredFinding[]> {
  const validated: StructuredFinding[] = [];
  for (const finding of findings) {
    validated.push({
      ...finding,
      evidenceValidation: await validateFindingEvidence(projectRoot, finding, allowedPaths, now)
    });
  }
  return validated;
}

export async function validateFindingEvidence(
  projectRoot: string,
  finding: StructuredFinding,
  allowedPaths?: Set<string>,
  now = new Date()
): Promise<FindingEvidenceValidation> {
  const references = evidenceReferencesForFinding(finding);
  const validationReferences: FindingEvidenceValidationReference[] = [];
  const warnings: string[] = [];

  if (!references.length) {
    warnings.push("Finding has no concrete evidence references.");
  }

  for (const reference of references) {
    const result = await validateReference(projectRoot, reference, allowedPaths);
    validationReferences.push(result);
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  return {
    checkedAt: now.toISOString(),
    passed: warnings.length === 0,
    warnings,
    references: validationReferences
  };
}

export function evidenceReferencesForFinding(finding: StructuredFinding): FindingEvidenceReference[] {
  if (finding.evidenceDetails?.length) {
    return finding.evidenceDetails;
  }

  const raw = finding.evidenceReferences?.length ? finding.evidenceReferences : finding.paths;
  const seen = new Set<string>();
  const references: FindingEvidenceReference[] = [];
  for (const item of raw ?? []) {
    const normalized = normalizeEvidencePath(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      references.push({ path: normalized });
    }
  }
  return references;
}

async function validateReference(
  projectRoot: string,
  reference: FindingEvidenceReference,
  allowedPaths?: Set<string>
): Promise<FindingEvidenceValidationReference> {
  const normalizedPath = normalizeEvidencePath(reference.path);
  if (!normalizedPath) {
    return {
      path: reference.path,
      exists: false,
      insideRoot: false,
      warning: `Evidence path is not a safe relative project path: ${reference.path}`
    };
  }

  if (allowedPaths?.size && !isAllowedPath(normalizedPath, allowedPaths)) {
    return {
      path: normalizedPath,
      exists: false,
      insideRoot: false,
      warning: `Evidence path was not part of the provider context manifest: ${normalizedPath}`
    };
  }

  const absolutePath = path.resolve(projectRoot, normalizedPath);
  const insideRoot = await resolvesInside(projectRoot, absolutePath);
  if (!insideRoot) {
    return {
      path: normalizedPath,
      exists: false,
      insideRoot: false,
      warning: `Evidence path resolves outside the project root: ${normalizedPath}`
    };
  }

  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return {
        path: normalizedPath,
        exists: true,
        insideRoot: true,
        warning: `Evidence path is not a file: ${normalizedPath}`
      };
    }
  } catch {
    return {
      path: normalizedPath,
      exists: false,
      insideRoot: true,
      warning: `Evidence path does not exist: ${normalizedPath}`
    };
  }

  const lineCheck = await validateLineAndQuote(absolutePath, normalizedPath, reference);
  return {
    path: normalizedPath,
    exists: true,
    insideRoot: true,
    ...lineCheck
  };
}

async function validateLineAndQuote(
  absolutePath: string,
  displayPath: string,
  reference: FindingEvidenceReference
): Promise<Pick<FindingEvidenceValidationReference, "lineRangeValid" | "quoteMatches" | "warning">> {
  if (!reference.startLine && !reference.quote) {
    return {};
  }

  let content = "";
  try {
    content = await readFile(absolutePath, "utf8");
  } catch {
    return {
      lineRangeValid: false,
      quoteMatches: false,
      warning: `Evidence file is not readable as UTF-8 text: ${displayPath}`
    };
  }

  const lines = content.split(/\r?\n/);
  let relevantText = content;
  if (reference.startLine) {
    const startLine = reference.startLine;
    const endLine = reference.endLine ?? startLine;
    const lineRangeValid = startLine >= 1 && endLine >= startLine && endLine <= lines.length;
    if (!lineRangeValid) {
      return {
        lineRangeValid: false,
        quoteMatches: reference.quote ? false : undefined,
        warning: `Evidence line range is outside ${displayPath}: ${startLine}-${endLine}`
      };
    }
    relevantText = lines.slice(startLine - 1, endLine).join("\n");
  }

  if (reference.quote) {
    const quoteMatches = normalizeWhitespace(relevantText).includes(normalizeWhitespace(reference.quote));
    if (!quoteMatches) {
      return {
        lineRangeValid: reference.startLine ? true : undefined,
        quoteMatches: false,
        warning: `Evidence quote was not found in ${displayPath}`
      };
    }
    return {
      lineRangeValid: reference.startLine ? true : undefined,
      quoteMatches: true
    };
  }

  return {
    lineRangeValid: true
  };
}

function normalizeEvidencePath(value: string | undefined): string | undefined {
  const normalized = (value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/g, "")
    .trim();
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized) || /\0/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function isAllowedPath(filePath: string, allowedPaths: Set<string>): boolean {
  if (allowedPaths.has(filePath)) {
    return true;
  }
  return Array.from(allowedPaths).some((allowed) => filePath.startsWith(`${allowed.replace(/\/+$/g, "")}/`));
}

async function resolvesInside(projectRoot: string, absolutePath: string): Promise<boolean> {
  try {
    const [rootReal, targetReal] = await Promise.all([
      realpath(projectRoot),
      realpath(absolutePath)
    ]);
    const relative = path.relative(rootReal, targetReal);
    return Boolean(relative || rootReal === targetReal) && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    const relative = path.relative(path.resolve(projectRoot), path.resolve(absolutePath));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
