import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { validateFindingEvidence } from "./evidence-validation.js";
import { collectDiffScope } from "./git-diff.js";
import { writeFindingExports } from "./exporters.js";
import {
  findingStateDirectory,
  loadStoredFindings,
  rewriteFindingStateAtomic,
  safeFindingFileName
} from "./finding-store.js";
import { findingDedupeKey } from "./findings.js";
import { revalidationJsonSchema } from "./provider-schema.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { validateReportRoot } from "./reports.js";
import type { AuditOptions, FindingStatus, StructuredFinding } from "./types.js";

export { findingStateDirectory, loadStoredFindings } from "./finding-store.js";

const STATUS_ORDER: FindingStatus[] = ["open", "uncertain", "fixed", "false-positive", "wont-fix"];
const execFileAsync = promisify(execFile);

export async function writeFindingState(
  projectRoot: string,
  outDir: string,
  findings: StructuredFinding[],
  runId: string,
  now = new Date(),
  options: Pick<AuditOptions, "ownerRules" | "labelRules" | "slaDays"> = {}
): Promise<string> {
  const stateDirectory = await findingStateDirectory(projectRoot, outDir);
  await mkdir(stateDirectory, { recursive: true });
  const existing = await loadStoredFindings(projectRoot, outDir);
  const existingById = new Map(existing.map((finding) => [finding.id, finding]));
  const existingByDedupe = new Map<string, StructuredFinding>();
  for (const finding of existing) {
    const key = findingDedupeKey(finding);
    if (!existingByDedupe.has(key)) {
      existingByDedupe.set(key, finding);
    }
  }
  const seenIds = new Set<string>();
  const seenDedupeKeys = new Set<string>();
  const updatedById = new Map<string, StructuredFinding>();

  for (const finding of findings) {
    const dedupeKey = findingDedupeKey(finding);
    const previous = existingById.get(finding.id) ?? existingByDedupe.get(dedupeKey);
    const findingId = previous?.id ?? finding.id;
    seenIds.add(findingId);
    seenDedupeKeys.add(dedupeKey);
    const mergedPrevious = updatedById.get(findingId) ?? previous;
    const status = previous?.status === "fixed" ? "open" : previous?.status ?? finding.status ?? "open";
    const merged: StructuredFinding = applyFindingLifecycleRules({
      ...mergedPrevious,
      ...finding,
      id: findingId,
      status,
      triage: mergedPrevious?.triage ?? finding.triage,
      firstSeenRunId: mergedPrevious?.firstSeenRunId ?? runId,
      lastSeenRunId: runId,
      createdAt: mergedPrevious?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      history: appendHistory(mergedPrevious?.history ?? finding.history, {
        runId,
        kind: "audit",
        status,
        note: auditHistoryNote(previous),
        commands: [],
        createdAt: now.toISOString()
      })
    }, options, now);
    updatedById.set(merged.id, merged);
  }

  for (const previous of existing) {
    if (!seenIds.has(previous.id) && !seenDedupeKeys.has(findingDedupeKey(previous))) {
      updatedById.set(previous.id, {
        ...previous,
        updatedAt: now.toISOString()
      });
    }
  }

  await rewriteFindingStateAtomic(projectRoot, outDir, Array.from(updatedById.values()));
  return stateDirectory;
}

function auditHistoryNote(previous: StructuredFinding | undefined): string {
  if (!previous) {
    return "Detected by RepoVista audit.";
  }
  if (previous.status === "fixed") {
    return "Reopened by RepoVista audit because the finding was detected again.";
  }
  return "Seen again by RepoVista audit.";
}

function applyFindingLifecycleRules(
  finding: StructuredFinding,
  options: Pick<AuditOptions, "ownerRules" | "labelRules" | "slaDays">,
  now: Date
): StructuredFinding {
  const owner = finding.owner ?? matchingRuleValue(finding, options.ownerRules ?? []);
  const labels = Array.from(new Set([
    ...(finding.labels ?? []),
    ...matchingRuleValues(finding, options.labelRules ?? [])
  ])).sort();
  const sla = typeof options.slaDays === "number"
    ? findingSla(finding.createdAt ?? finding.firstSeenRunId ?? now.toISOString(), options.slaDays, now)
    : finding.sla;
  return {
    ...finding,
    owner,
    labels: labels.length ? labels : finding.labels,
    sla
  };
}

function matchingRuleValue(finding: StructuredFinding, rules: string[]): string | undefined {
  return matchingRuleValues(finding, rules)[0];
}

function matchingRuleValues(finding: StructuredFinding, rules: string[]): string[] {
  const values: string[] = [];
  for (const rule of rules) {
    const parsed = parseLifecycleRule(rule);
    if (!parsed) {
      continue;
    }
    if (finding.paths.some((findingPath) => matchesRulePattern(findingPath, parsed.pattern))) {
      values.push(parsed.value);
    }
  }
  return values;
}

function parseLifecycleRule(rule: string): { pattern: string; value: string } | undefined {
  const separator = rule.includes("=") ? rule.indexOf("=") : rule.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const pattern = rule.slice(0, separator).trim();
  const value = rule.slice(separator + 1).trim();
  return pattern && value ? { pattern, value } : undefined;
}

function matchesRulePattern(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  if (normalizedPattern === "*" || normalizedPattern === normalizedValue) {
    return true;
  }
  const expression = normalizedPattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(normalizedValue) ||
    normalizedValue.startsWith(`${normalizedPattern.replace(/\/+$/g, "")}/`);
}

function findingSla(anchor: string, days: number, now: Date): StructuredFinding["sla"] {
  const anchorMs = Date.parse(anchor);
  const startMs = Number.isFinite(anchorMs) ? anchorMs : now.getTime();
  const dueAt = new Date(startMs + days * 24 * 60 * 60 * 1000).toISOString();
  return {
    days,
    dueAt,
    overdue: Date.parse(dueAt) < now.getTime()
  };
}

export async function runNextFindingCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const status = options.findingStatus ?? "open";
  const candidates = findings
    .filter((finding) => options.allFindings || (finding.status ?? "open") === status)
    .sort(compareFindings);

  if (!candidates.length) {
    return `No ${options.allFindings ? "" : `${status} `}RepoVista findings found in ${await findingStateDirectory(projectRoot, options.outDir)}.\n`;
  }

  return renderFinding(candidates[0], { concise: true });
}

export async function runListFindingsCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const listing = await loadFindingsForList(projectRoot, options);
  const findings = listing.findings;
  const status = options.findingStatus;
  const selected = findings
    .filter((finding) => options.allFindings || !status || (finding.status ?? "open") === status)
    .sort(compareFindings);

  if (options.exportFormats.length) {
    const outRoot = listing.outRoot ?? await validateReportRoot(projectRoot, options.outDir);
    const outputs = await writeFindingExports({
      outRoot,
      runDir: listing.runDir ?? outRoot,
      runId: listing.runId ?? "finding-state"
    }, selected, options.exportFormats);
    return `Exported ${selected.length} RepoVista finding(s):\n${renderList(Object.values(outputs).filter(Boolean) as string[])}\n`;
  }

  if (options.json) {
    return `${JSON.stringify(selected, null, 2)}\n`;
  }

  if (!selected.length) {
    return `No ${status && !options.allFindings ? `${status} ` : ""}RepoVista findings found in ${listing.source}.\n`;
  }

  return `${selected.map((finding) => [
    `${finding.id}  ${finding.severity.toUpperCase()}  ${finding.status ?? "open"}  ${finding.title}${finding.owner ? `  owner:${finding.owner}` : ""}${finding.sla?.overdue ? "  SLA:overdue" : finding.sla ? `  SLA:${finding.sla.dueAt.slice(0, 10)}` : ""}`,
    `  paths: ${finding.paths.join(", ") || "n/a"}`
  ].join("\n")).join("\n")}\n`;
}

async function loadFindingsForList(
  projectRoot: string,
  options: AuditOptions
): Promise<{ findings: StructuredFinding[]; source: string; outRoot?: string; runDir?: string; runId?: string }> {
  if (!options.findingRunId) {
    const stateDir = await findingStateDirectory(projectRoot, options.outDir);
    return {
      findings: await loadStoredFindings(projectRoot, options.outDir),
      source: stateDir
    };
  }

  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  const runDir = resolveRunDirectory(projectRoot, outRoot, options.findingRunId);
  const findingsPath = path.join(runDir, "findings.json");
  try {
    const parsed = JSON.parse(await readFile(findingsPath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("findings.json is not an array");
    }
    return {
      findings: parsed as StructuredFinding[],
      source: findingsPath,
      outRoot,
      runDir,
      runId: path.basename(runDir)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoVistaError(`Could not read RepoVista findings for run ${options.findingRunId}: ${message}`);
  }
}

function resolveRunDirectory(projectRoot: string, outRoot: string, value: string): string {
  const candidate = value.includes("/") || value.startsWith(".")
    ? path.resolve(projectRoot, value)
    : path.join(outRoot, value);
  const relative = path.relative(outRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RepoVistaError(`Run path must be inside ${outRoot}: ${value}`);
  }
  return candidate;
}

export async function runShowFindingCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const finding = await requireFinding(projectRoot, options);
  return renderFinding(finding, { concise: false });
}

export async function runTriageFindingCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const status = options.findingStatus;
  if (!status) {
    throw new RepoVistaError("Command triage requires --status <open|fixed|false-positive|wont-fix|uncertain>.");
  }
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const ids = options.allFindings ? new Set(findings.map((finding) => finding.id)) : new Set([requireFindingId(options)]);
  let changed = 0;
  const updated = findings.map((finding) => {
    if (!ids.has(finding.id)) {
      return finding;
    }
    changed += 1;
    return {
      ...finding,
      status,
      updatedAt: now.toISOString(),
      history: appendHistory(finding.history, {
        kind: "triage",
        status,
        note: options.note,
        commands: [],
        createdAt: now.toISOString()
      })
    };
  });
  if (!changed) {
    throw new RepoVistaError(options.allFindings ? "No findings found." : `Finding not found: ${requireFindingId(options)}`);
  }
  await rewriteFindingState(projectRoot, options.outDir, updated);
  return `Updated ${changed} RepoVista finding(s) to ${status}.\n`;
}

export async function runRevalidateFindingCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const diffScope = options.since ? await collectDiffScope(projectRoot, options.since) : undefined;
  const changedFiles = new Set(diffScope?.changedFiles ?? []);
  const baseSelected = options.allFindings
    ? findings
    : [findings.find((finding) => finding.id === requireFindingId(options))].filter((finding): finding is StructuredFinding => Boolean(finding));
  const selected = diffScope && options.allFindings
    ? baseSelected.filter((finding) => findingTouchedByDiff(finding, changedFiles))
    : baseSelected;
  if (!selected.length) {
    if (diffScope && options.allFindings) {
      return `No RepoVista findings intersect changed files since ${diffScope.ref}.\n`;
    }
    throw new RepoVistaError(options.allFindings ? "No findings found." : `Finding not found: ${requireFindingId(options)}`);
  }

  const selectedIds = new Set(selected.map((finding) => finding.id));
  const updated: StructuredFinding[] = [];
  for (const finding of findings) {
    if (!selectedIds.has(finding.id)) {
      updated.push(finding);
      continue;
    }
    const evidenceValidation = await validateFindingEvidence(projectRoot, finding, undefined, now);
    const status = statusFromValidation(evidenceValidation.passed, evidenceValidation.warnings, evidenceValidation.references.length);
    updated.push({
      ...finding,
      status,
      evidenceValidation,
      updatedAt: now.toISOString(),
      history: appendHistory(finding.history, {
        kind: "revalidate",
        status,
        reasoning: evidenceValidation.passed
          ? "Evidence references still resolve."
          : evidenceValidation.warnings.join(" "),
        commands: [],
        createdAt: now.toISOString()
      })
    });
  }

  await rewriteFindingState(projectRoot, options.outDir, updated);
  const rows = updated
    .filter((finding) => selectedIds.has(finding.id))
    .map((finding) => `- ${finding.id}: ${finding.status}${finding.evidenceValidation?.warnings.length ? ` (${finding.evidenceValidation.warnings.join("; ")})` : ""}`)
    .join("\n");
  const scopeLine = diffScope
    ? `Changed-file scope: ${diffScope.changedFiles.length} file(s) since ${diffScope.ref}.\n`
    : "";
  return `${scopeLine}Revalidated RepoVista findings:\n${rows}\n`;
}

export async function runProviderRevalidateFindingCommand(
  options: AuditOptions,
  dependencies: {
    projectRoot?: string;
    now?: Date;
    runProvider?: typeof runProviderPhase;
    spawnAdapter?: SpawnAdapter;
  } = {}
): Promise<string> {
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const now = dependencies.now ?? new Date();
  const runProvider = dependencies.runProvider ?? runProviderPhase;
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const selected = options.allFindings
    ? findings
    : [findings.find((finding) => finding.id === requireFindingId(options))].filter((finding): finding is StructuredFinding => Boolean(finding));
  if (!selected.length) {
    throw new RepoVistaError(options.allFindings ? "No findings found." : `Finding not found: ${requireFindingId(options)}`);
  }

  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  const reportsDir = path.join(outRoot, "revalidations");
  await mkdir(reportsDir, { recursive: true });
  const selectedIds = new Set(selected.map((finding) => finding.id));
  const updated: StructuredFinding[] = [];
  const rows: string[] = [];

  for (const finding of findings) {
    if (!selectedIds.has(finding.id)) {
      updated.push(finding);
      continue;
    }
    const reportPath = path.join(reportsDir, `${safeFileName(finding.id)}-${now.toISOString().replace(/[:.]/g, "-")}.md`);
    const result = await runProvider({
      provider: options.provider ?? "codex",
      phaseId: `finding-revalidate-${finding.id}`,
      phaseTitle: `Finding Revalidation ${finding.id}`,
      prompt: buildProviderRevalidationPrompt(finding),
      projectRoot,
      reportPath,
      logsDir: options.keepLogs ? path.join(outRoot, "logs") : undefined,
      model: options.model,
      profile: options.profile,
      reasoning: options.reasoning,
      fastMode: options.fastMode,
      sandbox: options.sandbox,
      jsonEvents: options.json,
      keepLogs: options.keepLogs,
      timeoutSeconds: options.phaseTimeoutSeconds ?? 1800,
      outputSchema: revalidationJsonSchema,
      outputSchemaKind: "revalidation"
    }, dependencies.spawnAdapter);
    const providerStatus = result.success
      ? parseProviderRevalidationStatus(await safeRead(reportPath))
      : "uncertain";
    updated.push({
      ...finding,
      status: providerStatus,
      updatedAt: now.toISOString(),
      history: appendHistory(finding.history, {
        kind: "provider-revalidate",
        status: providerStatus,
        reasoning: result.success ? `Provider revalidation report: ${reportPath}` : result.error,
        commands: [],
        createdAt: now.toISOString()
      })
    });
    rows.push(`- ${finding.id}: ${providerStatus}${result.success ? "" : ` (${result.error ?? "provider failed"})`}`);
  }

  await rewriteFindingState(projectRoot, options.outDir, updated);
  return `Provider-revalidated RepoVista findings:\n${rows.join("\n")}\n`;
}

export async function runCreateIssueCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const selected = options.allFindings
    ? findings.filter((finding) => options.allFindings || (finding.status ?? "open") === "open")
    : [findings.find((finding) => finding.id === requireFindingId(options))].filter((finding): finding is StructuredFinding => Boolean(finding));
  if (!selected.length) {
    throw new RepoVistaError(options.allFindings ? "No findings found." : `Finding not found: ${requireFindingId(options)}`);
  }

  if (options.dryRun) {
    return `GitHub issue dry run for ${selected.length} finding(s):\n\n${selected.map((finding) => renderIssueDryRun(finding, options)).join("\n\n---\n\n")}\n`;
  }

  const selectedIds = new Set(selected.map((finding) => finding.id));
  const rows: string[] = [];
  const updated: StructuredFinding[] = [];
  for (const finding of findings) {
    if (!selectedIds.has(finding.id)) {
      updated.push(finding);
      continue;
    }
    try {
      const synced = await syncGithubIssueForFinding(projectRoot, finding, options, now);
      updated.push(synced.finding);
      rows.push(`- ${finding.id}: ${synced.action} ${synced.url ?? ""}`.trimEnd());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push(`- ${finding.id}: failed (${message})`);
      updated.push(finding);
    }
  }

  await rewriteFindingState(projectRoot, options.outDir, updated);
  return `GitHub issue sync completed:\n${rows.join("\n")}\n`;
}

async function syncGithubIssueForFinding(
  projectRoot: string,
  finding: StructuredFinding,
  options: AuditOptions,
  now: Date
): Promise<{ finding: StructuredFinding; action: string; url?: string }> {
  const title = issueTitle(finding);
  const body = renderIssueBody(finding);
  const existingIssue = await findExistingIssue(projectRoot, finding.id);
  if (existingIssue && !options.issueUpdateExisting && !options.issueSync) {
    return {
      finding: issueLinkedFinding(finding, existingIssue, "open", options, now, "Existing GitHub issue detected."),
      action: "existing",
      url: existingIssue.url
    };
  }
  if (existingIssue) {
    const comment = `${body}\n\n_RepoVista synced this issue from finding ${finding.id}._`;
    await execFileAsync("gh", ["issue", "comment", String(existingIssue.number), "--body", comment], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    if (options.issueReopen && (finding.status ?? "open") === "open") {
      await reopenIssue(projectRoot, existingIssue.number);
    }
    await applyIssueMetadata(projectRoot, existingIssue.number, {
      ...options,
      issueLabels: combinedIssueLabels(finding, options)
    });
    return {
      finding: issueLinkedFinding(finding, existingIssue, "open", options, now, "Synced existing GitHub issue."),
      action: "updated",
      url: existingIssue.url
    };
  }

  const args = ["issue", "create", "--title", title, "--body", body];
  for (const label of combinedIssueLabels(finding, options)) {
    args.push("--label", label);
  }
  for (const assignee of options.issueAssignees ?? []) {
    args.push("--assignee", assignee);
  }
  const { stdout } = await execFileAsync("gh", args, {
    cwd: projectRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  const url = stdout.trim().split(/\r?\n/).find((line) => /^https?:\/\//.test(line.trim()))?.trim();
  const number = issueNumberFromUrl(url);
  return {
    finding: issueLinkedFinding(finding, { number, title, url }, "open", options, now, "Created GitHub issue."),
    action: "created",
    url
  };
}

function renderIssueDryRun(finding: StructuredFinding, options: AuditOptions): string {
  return `Title: ${issueTitle(finding)}
Labels: ${renderInlineList(combinedIssueLabels(finding, options))}
Assignees: ${renderInlineList(options.issueAssignees ?? [])}
Update existing: ${options.issueUpdateExisting || options.issueSync ? "yes" : "no"}
Reopen linked: ${options.issueReopen ? "yes" : "no"}

${renderIssueBody(finding)}`;
}

function issueTitle(finding: StructuredFinding): string {
  return `[RepoVista] ${finding.severity.toUpperCase()}: ${finding.title}`;
}

function issueLinkedFinding(
  finding: StructuredFinding,
  issue: { number?: number; title?: string; url?: string },
  state: "open" | "closed" | "unknown",
  options: AuditOptions,
  now: Date,
  note: string
): StructuredFinding {
  const status = finding.status ?? "open";
  return {
    ...finding,
    issue: {
      provider: "github",
      number: issue.number,
      url: issue.url,
      title: issue.title,
      state,
      syncedAt: now.toISOString(),
      labels: combinedIssueLabels(finding, options),
      assignees: options.issueAssignees ?? []
    },
    updatedAt: now.toISOString(),
    history: appendHistory(finding.history, {
      kind: "issue-sync",
      status,
      note,
      commands: ["gh issue"],
      createdAt: now.toISOString()
    })
  };
}

function combinedIssueLabels(finding: StructuredFinding, options: AuditOptions): string[] {
  return Array.from(new Set([
    ...(finding.labels ?? []),
    ...(options.issueLabels ?? [])
  ])).sort();
}

async function reopenIssue(projectRoot: string, issueNumber: number | undefined): Promise<void> {
  if (!issueNumber) {
    return;
  }
  await execFileAsync("gh", ["issue", "reopen", String(issueNumber)], {
    cwd: projectRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  }).catch(() => undefined);
}

function issueNumberFromUrl(url: string | undefined): number | undefined {
  const match = url?.match(/\/issues\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : undefined;
}

function buildProviderRevalidationPrompt(finding: StructuredFinding): string {
  return `You are revalidating one RepoVista finding in the current repository.

Work strictly read-only. Inspect only the current checkout and decide whether the finding is still open, fixed, or uncertain.

Finding:
${JSON.stringify(finding, null, 2)}

Return a short Markdown explanation and include this fenced JSON block:

\`\`\`json
{
  "status": "open | fixed | uncertain",
  "reasoning": "<brief evidence-based reason>",
  "evidenceReferences": ["src/example.ts"]
}
\`\`\`
`;
}

function parseProviderRevalidationStatus(report: string): FindingStatus {
  for (const block of report.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    try {
      const parsed = JSON.parse(block[1]) as { status?: string };
      const status = normalizeFindingStatus(parsed.status);
      if (status) {
        return status;
      }
    } catch {
      // Ignore non-status JSON blocks.
    }
  }
  if (/\bfixed\b/i.test(report) && !/\bnot fixed|unfixed|still open\b/i.test(report)) {
    return "fixed";
  }
  if (/\bopen|still present|still reproducible\b/i.test(report)) {
    return "open";
  }
  return "uncertain";
}

function normalizeFindingStatus(value: string | undefined): FindingStatus | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "fixed" ||
    normalized === "false-positive" ||
    normalized === "wont-fix" ||
    normalized === "uncertain"
  ) {
    return normalized;
  }
  return undefined;
}

async function findExistingIssue(projectRoot: string, findingId: string): Promise<{ number: number; title: string; url: string } | undefined> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "issue",
      "list",
      "--search",
      `${findingId} in:body`,
      "--json",
      "number,title,url",
      "--limit",
      "10"
    ], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(stdout) as Array<{ number?: number; title?: string; url?: string }>;
    const match = parsed.find((issue) => typeof issue.number === "number" && issue.url);
    return match
      ? { number: match.number as number, title: match.title ?? "", url: match.url as string }
      : undefined;
  } catch {
    return undefined;
  }
}

async function applyIssueMetadata(projectRoot: string, issueNumber: number, options: AuditOptions): Promise<void> {
  const labels = options.issueLabels ?? [];
  const assignees = options.issueAssignees ?? [];
  if (!labels.length && !assignees.length) {
    return;
  }
  const args = ["issue", "edit", String(issueNumber)];
  for (const label of labels) {
    args.push("--add-label", label);
  }
  for (const assignee of assignees) {
    args.push("--add-assignee", assignee);
  }
  await execFileAsync("gh", args, {
    cwd: projectRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
}

function renderIssueBody(finding: StructuredFinding): string {
  return `## RepoVista Finding

- ID: ${finding.id}
- Severity: ${finding.severity}
- Status: ${finding.status ?? "open"}
- Category: ${finding.category ?? "n/a"}
- Confidence: ${finding.confidence ?? "n/a"}
- Owner: ${finding.owner ?? "n/a"}
- Labels: ${finding.labels?.join(", ") || "n/a"}
- SLA: ${finding.sla ? `${finding.sla.dueAt}${finding.sla.overdue ? " (overdue)" : ""}` : "n/a"}

## Affected Paths

${renderList(finding.paths)}

## Evidence

${finding.evidence ?? "n/a"}

## Problem Rationale

${finding.problemRationale ?? "n/a"}

## Recommended Fix

${finding.recommendation ?? "n/a"}
`;
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function requireFinding(projectRoot: string, options: AuditOptions): Promise<StructuredFinding> {
  const id = requireFindingId(options);
  const finding = (await loadStoredFindings(projectRoot, options.outDir)).find((item) => item.id === id);
  if (!finding) {
    throw new RepoVistaError(`Finding not found: ${id}`);
  }
  return finding;
}

function requireFindingId(options: AuditOptions): string {
  if (!options.findingId) {
    throw new RepoVistaError("Command requires a finding id.");
  }
  return options.findingId;
}

async function rewriteFindingState(projectRoot: string, outDir: string, findings: StructuredFinding[]): Promise<void> {
  await rewriteFindingStateAtomic(projectRoot, outDir, findings);
}

function safeFileName(value: string): string {
  return safeFindingFileName(value);
}

function compareFindings(left: StructuredFinding, right: StructuredFinding): number {
  return severityRank(right.severity) - severityRank(left.severity) ||
    confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
    STATUS_ORDER.indexOf(left.status ?? "open") - STATUS_ORDER.indexOf(right.status ?? "open") ||
    left.title.localeCompare(right.title);
}

function severityRank(value: StructuredFinding["severity"]): number {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    unknown: 0
  }[value] ?? 0;
}

function confidenceRank(value: string | undefined): number {
  const normalized = value?.toLowerCase();
  if (normalized === "high") {
    return 3;
  }
  if (normalized === "medium") {
    return 2;
  }
  if (normalized === "low") {
    return 1;
  }
  return 0;
}

function statusFromValidation(passed: boolean, warnings: string[], referenceCount: number): FindingStatus {
  if (passed) {
    return "open";
  }
  if (!referenceCount || warnings.some((warning) => /no concrete evidence/i.test(warning))) {
    return "uncertain";
  }
  if (warnings.every((warning) => /does not exist|quote was not found|line range is outside/i.test(warning))) {
    return "fixed";
  }
  return "uncertain";
}

function findingTouchedByDiff(finding: StructuredFinding, changedFiles: Set<string>): boolean {
  if (!changedFiles.size) {
    return false;
  }
  return finding.paths.some((findingPath) =>
    changedFiles.has(findingPath) ||
    Array.from(changedFiles).some((changedFile) => changedFile.startsWith(`${findingPath.replace(/\/+$/g, "")}/`))
  );
}

function appendHistory(
  existing: StructuredFinding["history"] | undefined,
  entry: NonNullable<StructuredFinding["history"]>[number]
): NonNullable<StructuredFinding["history"]> {
  const history = existing ? [...existing] : [];
  const previous = history[history.length - 1];
  if (
    previous?.kind === entry.kind &&
    previous.status === entry.status &&
    previous.runId === entry.runId &&
    previous.note === entry.note
  ) {
    return history;
  }
  history.push(entry);
  return history;
}

function renderFinding(finding: StructuredFinding, options: { concise: boolean }): string {
  const evidenceWarnings = finding.evidenceValidation?.warnings ?? [];
  const historyLines = finding.history?.slice(-8).map((entry) => {
    const parts = [
      entry.createdAt,
      entry.kind,
      entry.status,
      entry.runId ? `run ${entry.runId}` : undefined,
      entry.note ?? entry.reasoning
    ].filter(Boolean);
    return `- ${parts.join(" - ")}`;
  }) ?? [];

  return `# ${finding.id}: ${finding.title}

Status: ${finding.status ?? "open"}
Severity: ${finding.severity}
Category: ${finding.category ?? "n/a"}
Triage: ${finding.triage ?? "review"}
Confidence: ${finding.confidence ?? "n/a"}
Owner: ${finding.owner ?? "n/a"}
Labels: ${finding.labels?.join(", ") || "n/a"}
SLA: ${finding.sla ? `${finding.sla.dueAt}${finding.sla.overdue ? " (overdue)" : ""}` : "n/a"}
Issue: ${finding.issue?.url ?? "n/a"}

Affected paths:
${renderList(finding.paths)}

Evidence references:
${renderList(renderEvidenceReferences(finding.evidenceReferences ?? finding.paths))}

${finding.evidence ? `Evidence: ${finding.evidence}\n` : ""}
${finding.problemRationale && !options.concise ? `Problem rationale: ${finding.problemRationale}\n` : ""}
${finding.recommendation ? `Recommendation: ${finding.recommendation}\n` : ""}
${evidenceWarnings.length ? `Evidence validation warnings:\n${renderList(evidenceWarnings)}\n` : ""}
${!options.concise && historyLines.length ? `History:\n${historyLines.join("\n")}\n` : ""}
Next commands:
- repovista show ${finding.id}
- repovista triage ${finding.id} --status fixed --note "validated"
- repovista revalidate ${finding.id}
`;
}

function renderList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- n/a";
}

function renderEvidenceReferences(references: NonNullable<StructuredFinding["evidenceReferences"]> | string[]): string[] {
  return references.map((reference) => {
    if (typeof reference === "string") {
      return reference;
    }
    const range = reference.startLine
      ? `:${reference.startLine}${reference.endLine && reference.endLine !== reference.startLine ? `-${reference.endLine}` : ""}`
      : "";
    return `${reference.path}${range}${reference.quote ? ` (${reference.quote})` : ""}`;
  });
}

function renderInlineList(items: string[]): string {
  return items.length ? items.join(", ") : "none";
}
