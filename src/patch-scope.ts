import type { PatchAttempt, StructuredFinding } from "./types.js";

export function evaluatePatchScope(
  findings: StructuredFinding[],
  filesChanged: string[],
  maxFiles: number
): NonNullable<PatchAttempt["scopeGate"]> {
  const allowedPaths = allowedPatchScopePaths(findings);
  const violations: string[] = [];
  if (filesChanged.length > maxFiles) {
    violations.push(`changed ${filesChanged.length} files, max is ${maxFiles}`);
  }
  if (allowedPaths.length) {
    const outside = filesChanged.filter((file) => !allowedPaths.some((allowed) => pathMatchesScope(file, allowed)));
    if (outside.length) {
      violations.push(`changed files outside finding scope: ${outside.join(", ")}`);
    }
  }
  return {
    passed: violations.length === 0,
    maxFiles,
    allowedPaths,
    violations
  };
}

function allowedPatchScopePaths(findings: StructuredFinding[]): string[] {
  const allowed = new Set<string>();
  for (const finding of findings) {
    for (const file of finding.paths ?? []) {
      addNormalizedPath(allowed, file);
    }
    for (const field of findingScopeTextFields(finding)) {
      for (const file of pathMentions(field)) {
        addNormalizedPath(allowed, file);
      }
    }
    const text = findingScopeTextFields(finding).join("\n");
    const roots = sourceRoots(finding.paths ?? []);
    if (/\b(regression test|tests?|spec|coverage)\b/i.test(text)) {
      for (const root of roots) {
        addNormalizedPath(allowed, `${root}/__tests__/`);
        addNormalizedPath(allowed, `${root}/tests/`);
        const packageRoot = root.replace(/\/src$/u, "");
        addNormalizedPath(allowed, `${packageRoot}/test/`);
        addNormalizedPath(allowed, `${packageRoot}/tests/`);
      }
    }
    if (/\b(document(?:ed|ation)?|docs?|readme)\b/i.test(text)) {
      addNormalizedPath(allowed, "README.md");
      addNormalizedPath(allowed, "docs/");
    }
    if (/\b(middleware|auth|authorization|authentication|token)\b/i.test(text)) {
      for (const root of roots) {
        addNormalizedPath(allowed, `${root}/middleware/`);
        addNormalizedPath(allowed, `${root}/middlewares/`);
        addNormalizedPath(allowed, `${root}/lib/`);
        addNormalizedPath(allowed, `${root}/utils/`);
      }
    }
  }
  return Array.from(allowed).sort();
}

function findingScopeTextFields(finding: StructuredFinding): string[] {
  return [
    finding.title,
    finding.evidence,
    finding.problemRationale,
    finding.recommendation,
    finding.reproduction,
    finding.suggestedRegressionTest,
    finding.minimumFixScope
  ].filter((value): value is string => Boolean(value));
}

function pathMentions(text: string): string[] {
  const paths: string[] = [];
  const matches = text.matchAll(/`([^`]+)`|(?:^|[\s([,{])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?)/g);
  for (const match of matches) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    const normalized = normalizePathMention(raw);
    if (normalized) {
      paths.push(normalized);
    }
  }
  return paths;
}

function normalizePathMention(value: string): string | undefined {
  const cleaned = value
    .replace(/[),.;:]+$/u, "")
    .replace(/^\.\/+/u, "")
    .replace(/\\/g, "/")
    .trim();
  if (!cleaned || cleaned.startsWith("/") || cleaned.includes("://") || cleaned.includes("*") || cleaned.includes(" ")) {
    return undefined;
  }
  if (!cleaned.includes("/") || /^api\//iu.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function sourceRoots(paths: string[]): string[] {
  const roots = new Set<string>();
  for (const file of paths) {
    const normalized = normalizePathMention(file);
    if (!normalized) {
      continue;
    }
    const sourceIndex = normalized.indexOf("/src/");
    if (sourceIndex !== -1) {
      roots.add(normalized.slice(0, sourceIndex + 4));
      continue;
    }
    const parts = normalized.split("/");
    if (parts.length > 1) {
      roots.add(parts[0] ?? "");
    }
  }
  return Array.from(roots).filter(Boolean);
}

function addNormalizedPath(allowed: Set<string>, file: string): void {
  const normalized = normalizeScopePath(file);
  if (normalized) {
    allowed.add(normalized);
  }
}

function normalizeScopePath(value: string): string | undefined {
  const normalized = normalizePathMention(value) ?? value.replace(/\\/g, "/").replace(/^\.\/+/u, "").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("://")) {
    return undefined;
  }
  return normalized;
}

function pathMatchesScope(file: string, allowed: string): boolean {
  const normalizedFile = file.replace(/\\/g, "/").replace(/^\.\/+/u, "");
  const normalizedAllowed = allowed.replace(/\\/g, "/").replace(/^\.\/+/u, "");
  if (normalizedFile === normalizedAllowed) {
    return true;
  }
  if (normalizedAllowed.endsWith("/")) {
    return normalizedFile.startsWith(normalizedAllowed);
  }
  return normalizedFile.startsWith(`${normalizedAllowed.replace(/\/+$/gu, "")}/`) || sameTopLevelTestPath(normalizedFile, normalizedAllowed);
}

function sameTopLevelTestPath(left: string, right: string): boolean {
  const [leftTop] = left.split("/");
  const [rightTop] = right.split("/");
  return Boolean(leftTop && rightTop && leftTop === rightTop && (leftTop === "test" || leftTop === "tests"));
}
