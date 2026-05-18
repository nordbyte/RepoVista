import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import { validateFindingEvidence } from "./evidence-validation.js";
import { validateReportRoot } from "./reports.js";
import type { AuditOptions, FindingStatus, StructuredFinding } from "./types.js";

const FINDING_STATE_VERSION = 1;
const STATUS_ORDER: FindingStatus[] = ["open", "uncertain", "fixed", "false-positive", "wont-fix"];

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

export async function runShowFindingCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const finding = await requireFinding(projectRoot, options);
  return renderFinding(finding, { concise: false });
}

export async function runTriageFindingCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const id = requireFindingId(options);
  const status = options.findingStatus;
  if (!status) {
    throw new RepoVistaError("Command triage requires --status <open|fixed|false-positive|wont-fix|uncertain>.");
  }
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const index = findings.findIndex((finding) => finding.id === id);
  if (index < 0) {
    throw new RepoVistaError(`Finding not found: ${id}`);
  }
  findings[index] = {
    ...findings[index],
    status,
    updatedAt: now.toISOString(),
    history: appendHistory(findings[index].history, {
      kind: "triage",
      status,
      note: options.note,
      commands: [],
      createdAt: now.toISOString()
    })
  };
  await rewriteFindingState(projectRoot, options.outDir, findings);
  return `Updated ${id} to ${status}.\n`;
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
