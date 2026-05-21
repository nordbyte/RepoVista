import type { PatchAttempt, StructuredFinding } from "./types.js";

const MAX_PR_TITLE_DESCRIPTION = 80;

export function defaultPullRequestTitleForFindings(findings: StructuredFinding[]): string {
  if (findings.length === 1) {
    return `fix: ${conciseDescription(findings[0].title)}`;
  }
  return `fix: address ${findings.length} RepoVista findings`;
}

export function defaultPullRequestTitleForPatch(patch: PatchAttempt): string {
  const title = firstFindingTitleFromPlan(patch.plan);
  if (title) {
    return `fix: ${conciseDescription(title)}`;
  }
  if (patch.findingIds.length === 1) {
    return `fix: address finding ${patch.findingIds[0]}`;
  }
  return `fix: address ${patch.findingIds.length} RepoVista findings`;
}

function firstFindingTitleFromPlan(plan: string): string | undefined {
  const line = plan.split(/\r?\n/).find((item) => item.startsWith("Finding: "));
  const title = line?.replace(/^Finding:\s+\S+\s+-\s+/, "").trim();
  return title || undefined;
}

function conciseDescription(value: string): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
  const decapitalized = normalized.replace(/^([A-Z])(?=[a-z])/, (match) => match.toLowerCase());
  return truncateAtWord(decapitalized, MAX_PR_TITLE_DESCRIPTION) || "address RepoVista finding";
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const truncated = value.slice(0, maxLength + 1);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${(lastSpace > 40 ? truncated.slice(0, lastSpace) : value.slice(0, maxLength)).trimEnd()}...`;
}
