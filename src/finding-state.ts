import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { validateFindingEvidence } from "./evidence-validation.js";
import { writeFindingExports } from "./exporters.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { validateReportRoot } from "./reports.js";
import type { AuditOptions, FindingStatus, StructuredFinding } from "./types.js";

const FINDING_STATE_VERSION = 1;
const STATUS_ORDER: FindingStatus[] = ["open", "uncertain", "fixed", "false-positive", "wont-fix"];
const execFileAsync = promisify(execFile);

export async function writeFindingState(
  projectRoot: string,
  outDir: string,
  findings: StructuredFinding[],
  runId: string,
  now = new Date()
): Promise<string> {
  const stateDirectory = await findingStateDirectory(projectRoot, outDir);
  await mkdir(stateDirectory, { recursive: true });
  const existing = await loadStoredFindings(projectRoot, outDir);
  const existingById = new Map(existing.map((finding) => [finding.id, finding]));
  const seenIds = new Set<string>();

  for (const finding of findings) {
    seenIds.add(finding.id);
    const previous = existingById.get(finding.id);
    const status = previous?.status === "fixed" ? "open" : previous?.status ?? finding.status ?? "open";
    const merged: StructuredFinding = {
      ...previous,
      ...finding,
      status,
      triage: previous?.triage ?? finding.triage,
      firstSeenRunId: previous?.firstSeenRunId ?? runId,
      lastSeenRunId: runId,
      createdAt: previous?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      history: appendHistory(previous?.history ?? finding.history, {
        runId,
        kind: "audit",
        status,
        note: auditHistoryNote(previous),
        commands: [],
        createdAt: now.toISOString()
      })
    };
    await writeFindingFile(stateDirectory, merged);
  }

  for (const previous of existing) {
    if (!seenIds.has(previous.id)) {
      await writeFindingFile(stateDirectory, {
        ...previous,
        updatedAt: now.toISOString()
      });
    }
  }

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
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const status = options.findingStatus;
  const selected = findings
    .filter((finding) => options.allFindings || !status || (finding.status ?? "open") === status)
    .sort(compareFindings);

  if (options.exportFormats.length) {
    const outRoot = await validateReportRoot(projectRoot, options.outDir);
    const outputs = await writeFindingExports({
      outRoot,
      runDir: outRoot,
      runId: "finding-state"
    }, selected, options.exportFormats);
    return `Exported ${selected.length} RepoVista finding(s):\n${renderList(Object.values(outputs).filter(Boolean) as string[])}\n`;
  }

  if (options.json) {
    return `${JSON.stringify(selected, null, 2)}\n`;
  }

  if (!selected.length) {
    return `No ${status && !options.allFindings ? `${status} ` : ""}RepoVista findings found in ${await findingStateDirectory(projectRoot, options.outDir)}.\n`;
  }

  return `${selected.map((finding) => [
    `${finding.id}  ${finding.severity.toUpperCase()}  ${finding.status ?? "open"}  ${finding.title}`,
    `  paths: ${finding.paths.join(", ") || "n/a"}`
  ].join("\n")).join("\n")}\n`;
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
  const selected = options.allFindings
    ? findings
    : [findings.find((finding) => finding.id === requireFindingId(options))].filter((finding): finding is StructuredFinding => Boolean(finding));
  if (!selected.length) {
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
  return `Revalidated RepoVista findings:\n${rows}\n`;
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
      timeoutSeconds: options.phaseTimeoutSeconds ?? 1800
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

export async function runCreateIssueCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const finding = await requireFinding(projectRoot, options);
  const title = `[RepoVista] ${finding.severity.toUpperCase()}: ${finding.title}`;
  const body = renderIssueBody(finding);
  if (options.dryRun) {
    return `GitHub issue dry run:\n\nTitle: ${title}\n\n${body}\n`;
  }

  try {
    const { stdout } = await execFileAsync("gh", ["issue", "create", "--title", title, "--body", body], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim() ? `${stdout.trim()}\n` : `Created GitHub issue for ${finding.id}.\n`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoVistaError(`Could not create GitHub issue with gh: ${message}`);
  }
}

export async function loadStoredFindings(projectRoot: string, outDir: string): Promise<StructuredFinding[]> {
  const stateDirectory = await findingStateDirectory(projectRoot, outDir);
  try {
    const entries = await readdir(stateDirectory, { withFileTypes: true });
    const findings: StructuredFinding[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const parsed = JSON.parse(await readFile(path.join(stateDirectory, entry.name), "utf8")) as {
        version?: number;
        finding?: StructuredFinding;
      };
      if (parsed.version === FINDING_STATE_VERSION && parsed.finding?.id) {
        findings.push(parsed.finding);
      }
    }
    return findings.sort(compareFindings);
  } catch {
    return [];
  }
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

function renderIssueBody(finding: StructuredFinding): string {
  return `## RepoVista Finding

- ID: ${finding.id}
- Severity: ${finding.severity}
- Status: ${finding.status ?? "open"}
- Category: ${finding.category ?? "n/a"}
- Confidence: ${finding.confidence ?? "n/a"}

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

export async function findingStateDirectory(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "findings");
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
  const stateDirectory = await findingStateDirectory(projectRoot, outDir);
  await mkdir(stateDirectory, { recursive: true });
  await rm(stateDirectory, { recursive: true, force: true });
  await mkdir(stateDirectory, { recursive: true });
  for (const finding of findings) {
    await writeFindingFile(stateDirectory, finding);
  }
}

async function writeFindingFile(stateDirectory: string, finding: StructuredFinding): Promise<void> {
  await writeFile(path.join(stateDirectory, `${safeFileName(finding.id)}.json`), `${JSON.stringify({
    version: FINDING_STATE_VERSION,
    finding
  }, null, 2)}\n`, "utf8");
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
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

Affected paths:
${renderList(finding.paths)}

Evidence references:
${renderList(finding.evidenceReferences ?? finding.paths)}

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
