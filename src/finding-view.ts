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
    githubIssueStatusLabel(finding),
    githubPullRequestStatusLabel(finding),
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
      "## GitHub",
      "",
      ...githubLinkDetailLines(finding),
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

export function githubIssueStatusLabel(finding: StructuredFinding): string {
  const issue = finding.issue;
  if (!issue?.url && !issue?.number) {
    return "no issue";
  }
  if (issue.state === "closed" && issue.stateReason) {
    return `issue closed/${issue.stateReason}`;
  }
  if (issue.state && issue.state !== "unknown") {
    return `issue ${issue.state}`;
  }
  if (issue.lastStatusError) {
    return "issue unknown";
  }
  return "issue linked";
}

export function githubPullRequestStatusLabel(finding: StructuredFinding): string {
  const pr = finding.pullRequest;
  if (!pr?.url && !pr?.number) {
    return "no PR";
  }
  if (pr.state === "merged") {
    return "PR merged";
  }
  if (pr.state === "open" && pr.isDraft) {
    return "PR draft";
  }
  if (pr.state && pr.state !== "unknown") {
    return `PR ${pr.state}`;
  }
  if (pr.lastStatusError) {
    return "PR unknown";
  }
  return "PR linked";
}

function githubLinkDetailLines(finding: StructuredFinding): string[] {
  const lines: string[] = [];
  if (finding.issue?.url || finding.issue?.number) {
    lines.push(
      `- Issue: ${githubIssueStatusLabel(finding).replace(/^issue /, "")}`,
      `- Issue URL: ${finding.issue.url ?? "n/a"}`,
      `- Issue repository: ${finding.issue.repository ?? "n/a"}`,
      `- Issue last checked: ${finding.issue.lastStatusCheckAt ?? finding.issue.syncedAt ?? "n/a"}`
    );
    if (finding.issue.lastStatusError) {
      lines.push(`- Issue status error: ${finding.issue.lastStatusError}`);
    }
  } else {
    lines.push("- Issue: n/a");
  }
  if (finding.pullRequest?.url || finding.pullRequest?.number) {
    lines.push(
      `- Pull request: ${githubPullRequestStatusLabel(finding).replace(/^PR /, "")}`,
      `- Pull request URL: ${finding.pullRequest.url ?? "n/a"}`,
      `- Pull request repository: ${finding.pullRequest.repository ?? "n/a"}`,
      `- Pull request last checked: ${finding.pullRequest.lastStatusCheckAt ?? finding.pullRequest.syncedAt ?? "n/a"}`
    );
    if (finding.pullRequest.mergedAt) {
      lines.push(`- Pull request merged at: ${finding.pullRequest.mergedAt}`);
    }
    if (finding.pullRequest.closedAt) {
      lines.push(`- Pull request closed at: ${finding.pullRequest.closedAt}`);
    }
    if (finding.pullRequest.lastStatusError) {
      lines.push(`- Pull request status error: ${finding.pullRequest.lastStatusError}`);
    }
  } else {
    lines.push("- Pull request: n/a");
  }
  return lines.filter((line): line is string => Boolean(line));
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
