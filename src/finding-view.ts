import { evidenceReferencesForFinding } from "./evidence-validation.js";
import type { FindingEvidenceReference, FindingStatus, PublishTarget, StructuredFinding } from "./types.js";

export type FindingWorkflowFilter = "all" | "open" | "critical-high" | "without-issue" | "without-pr" | "overdue" | "publishable";

export interface FindingViewContext {
  diffLabel?: string;
  layout?: "compact" | "normal" | "detailed";
  publishable?: boolean;
  sourceLabel?: string;
  queueTarget?: PublishTarget;
}

export function findingQueueMarker(target: PublishTarget | undefined): string {
  return target === "issue" ? "I" : target === "pr" ? "P" : " ";
}

export function findingPublishReadiness(finding: StructuredFinding, publishable: boolean | undefined): string {
  return [
    publishable ? "github ok" : "github n/a",
    finding.issue?.url ? "issue linked" : "no issue",
    finding.pullRequest?.url ? "PR linked" : "no PR",
    evidenceReferencesForFinding(finding).length ? "evidence ok" : "weak evidence"
  ].join(" | ");
}

export function findingWorkflowFilterLabel(filter: FindingWorkflowFilter | undefined): string {
  return `workflow ${filter ?? "all"}`;
}

export function nextFindingWorkflowFilter(current: FindingWorkflowFilter | undefined): FindingWorkflowFilter {
  const values: FindingWorkflowFilter[] = ["all", "open", "critical-high", "without-issue", "without-pr", "overdue", "publishable"];
  return values[(values.indexOf(current ?? "all") + 1) % values.length];
}

export function matchesFindingWorkflowFilter(
  finding: StructuredFinding,
  filter: FindingWorkflowFilter | undefined,
  context: Pick<FindingViewContext, "publishable"> = {}
): boolean {
  switch (filter ?? "all") {
    case "all":
      return true;
    case "open":
      return (finding.status ?? "open") === "open";
    case "critical-high":
      return finding.severity === "critical" || finding.severity === "high";
    case "without-issue":
      return !finding.issue?.url;
    case "without-pr":
      return !finding.pullRequest?.url;
    case "overdue":
      return Boolean(finding.sla?.overdue);
    case "publishable":
      return Boolean(context.publishable);
  }
}

export function renderStructuredFindingDetail(finding: StructuredFinding, context: FindingViewContext = {}): string[] {
  const references = evidenceReferencesForFinding(finding);
  const layout = context.layout ?? "normal";
  const lines = [
    `# ${finding.title}`,
    "",
    `- ID: ${finding.id}`,
    `- Severity: ${finding.severity}`,
    `- Status: ${finding.status ?? "open"}`,
    context.diffLabel ? `- Diff: ${context.diffLabel}` : undefined,
    `- Category: ${finding.category ?? "n/a"}`,
    `- Confidence: ${finding.confidence ?? "n/a"}`,
    `- Owner: ${finding.owner ?? "n/a"}`,
    `- Labels: ${finding.labels?.join(", ") || "n/a"}`,
    `- SLA: ${finding.sla ? `${finding.sla.dueAt}${finding.sla.overdue ? " (overdue)" : ""}` : "n/a"}`,
    `- First seen: ${finding.firstSeenRunId ?? finding.createdAt ?? "n/a"}`,
    `- Last seen: ${finding.lastSeenRunId ?? finding.updatedAt ?? "n/a"}`,
    `- Publish readiness: ${findingPublishReadiness(finding, context.publishable)}`,
    context.sourceLabel ? `- Publish source: ${context.sourceLabel}` : undefined,
    context.queueTarget ? `- Queued target: ${context.queueTarget}` : undefined,
    "",
    "## Paths",
    "",
    ...(finding.paths.length ? finding.paths.map((item) => `- ${item}`) : ["- n/a"]),
    "",
    "## Evidence",
    "",
    finding.evidence ?? "n/a"
  ].filter((line): line is string => line !== undefined);

  if (layout !== "compact") {
    lines.push(
      "",
      "## Recommendation",
      "",
      finding.recommendation ?? "n/a",
      "",
      "## Problem Rationale",
      "",
      finding.problemRationale ?? "n/a",
      "",
      "## Reproduction",
      "",
      finding.reproduction ?? "n/a",
      "",
      "## Suggested Regression Test",
      "",
      finding.suggestedRegressionTest ?? "n/a"
    );
  }

  if (layout === "detailed") {
    lines.push(
      "",
      "## Minimum Fix Scope",
      "",
      finding.minimumFixScope ?? "n/a",
      "",
      "## Issue",
      "",
      finding.issue?.url ?? "n/a",
      "",
      "## Pull Request",
      "",
      finding.pullRequest?.url ?? "n/a",
      "",
      "## History",
      "",
      ...(finding.history?.length ? finding.history.map(formatHistoryEntry) : ["- n/a"])
    );
  }

  lines.push(
    "",
    "## Evidence References",
    "",
    ...(references.length ? references.map((reference, index) => `${index + 1}. ${formatEvidenceReference(reference)}${reference.quote ? ` - ${reference.quote}` : ""}`) : ["n/a"])
  );

  return lines;
}

export function statusCycleLabel(status: FindingStatus | "all" | undefined): string {
  return `status ${status ?? "all"}`;
}

function formatHistoryEntry(entry: NonNullable<StructuredFinding["history"]>[number]): string {
  return `- ${entry.createdAt}: ${entry.kind} -> ${entry.status ?? "n/a"}${entry.note ? ` (${entry.note})` : ""}`;
}

function formatEvidenceReference(reference: FindingEvidenceReference): string {
  const line = reference.startLine
    ? reference.endLine && reference.endLine !== reference.startLine
      ? `:${reference.startLine}-${reference.endLine}`
      : `:${reference.startLine}`
    : "";
  return `${reference.path}${line}${reference.symbol ? ` (${reference.symbol})` : ""}`;
}
