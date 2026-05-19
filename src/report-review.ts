import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { validateReportQuality } from "./quality-gates.js";
import type { AuditMeta, AuditOptions, PhaseReportStatus, StructuredFinding, StructuredPhaseReport } from "./types.js";

const execFileAsync = promisify(execFile);

const REPORT_FILES = [
  ["architecture", "01-architecture-report.md"],
  ["code-quality", "02-code-quality-report.md"],
  ["risk-and-bug", "03-risk-and-bug-report.md"],
  ["feature-roadmap", "04-feature-roadmap.md"],
  ["summary", "index.md"]
] as const;

export interface ReviewedRun {
  runDir: string;
  meta?: AuditMeta;
  findings: StructuredFinding[];
  structuredReports: StructuredPhaseReport[];
  artifactHealth: ArtifactHealthCheck[];
  reportReviews: Array<{
    phaseId: string;
    fileName: string;
    readable: boolean;
    lines: number;
    qualityPassed: boolean;
    qualityScore: number;
    warnings: string[];
  }>;
  weakEvidence: Array<{
    id: string;
    title: string;
    severity: StructuredFinding["severity"];
    warnings: string[];
  }>;
  staleWarnings: string[];
}

export interface ArtifactHealthCheck {
  name: string;
  fileName: string;
  required: boolean;
  exists: boolean;
  readable: boolean;
  valid: boolean;
  sizeBytes?: number;
  warnings: string[];
}

export async function runReviewCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const reviewed = await reviewRunDirectory(projectRoot, requireRunDir(options));
  if (options.json) {
    return `${JSON.stringify(reviewed, null, 2)}\n`;
  }
  return renderRunReview(reviewed);
}

export async function runPrCommentCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const reviewed = await reviewRunDirectory(projectRoot, requireRunDir(options));
  const body = renderPrComment(reviewed);
  if (options.dryRun) {
    return `RepoVista PR comment dry run:\n\n${body}\n`;
  }

  try {
    const { stdout } = await execFileAsync("gh", ["pr", "comment", "--body", body], {
      cwd: projectRoot,
      timeout: 60_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim() ? `${stdout.trim()}\n` : "Posted RepoVista PR comment.\n";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoVistaError(`Could not post RepoVista PR comment with gh: ${message}`);
  }
}

export async function reviewRunDirectory(projectRoot: string, runDirectory: string): Promise<ReviewedRun> {
  const runDir = path.resolve(projectRoot, runDirectory);
  await assertDirectory(runDir);
  const [meta, findings, structuredReports] = await Promise.all([
    readJson<AuditMeta>(path.join(runDir, "meta.json")),
    readJson<StructuredFinding[]>(path.join(runDir, "findings.json")),
    readJson<StructuredPhaseReport[]>(path.join(runDir, "structured-reports.json"))
  ]);
  const normalizedFindings = Array.isArray(findings) ? findings : [];
  const normalizedStructuredReports = Array.isArray(structuredReports) ? structuredReports : [];
  const reportReviews = await Promise.all(REPORT_FILES.map(async ([phaseId, fileName]) => {
    const filePath = path.join(runDir, fileName);
    const content = await readText(filePath);
    if (content === undefined) {
      return {
        phaseId,
        fileName,
        readable: false,
        lines: 0,
        qualityPassed: false,
        qualityScore: 0,
        warnings: [`Report file is missing or unreadable: ${fileName}`]
      };
    }
    const quality = validateReportQuality(phaseId, content);
    return {
      phaseId,
      fileName,
      readable: true,
      lines: content.split(/\r?\n/).filter((line) => line.trim()).length,
      qualityPassed: quality.passed,
      qualityScore: quality.score,
      warnings: quality.warnings
    };
  }));

  return {
    runDir,
    meta,
    findings: normalizedFindings,
    structuredReports: normalizedStructuredReports,
    artifactHealth: await inspectArtifactHealth(runDir, meta, normalizedFindings, normalizedStructuredReports),
    reportReviews,
    weakEvidence: weakEvidenceFindings(normalizedFindings),
    staleWarnings: await staleWarnings(projectRoot, meta)
  };
}

export function renderRunReview(reviewed: ReviewedRun): string {
  const failedReports = reviewed.reportReviews.filter((report) => !report.qualityPassed);
  const unhealthyArtifacts = reviewed.artifactHealth.filter((artifact) => artifact.warnings.length);
  return `# RepoVista Run Review

Run: \`${reviewed.meta?.runId ?? path.basename(reviewed.runDir)}\`
Directory: \`${reviewed.runDir}\`
Provider: ${reviewed.meta?.ai.displayName ?? "not recorded"}
Model: ${reviewed.meta?.ai.model ?? "not recorded"}
Reasoning: ${reviewed.meta?.ai.reasoning ?? "not recorded"}

## Quality Summary

- Reports checked: ${reviewed.reportReviews.length}
- Reports with warnings: ${failedReports.length}
- Findings checked: ${reviewed.findings.length}
- Weak evidence findings: ${reviewed.weakEvidence.length}
- Stale state warnings: ${reviewed.staleWarnings.length}
- Artifact health warnings: ${unhealthyArtifacts.length}

## Artifact Health

${unhealthyArtifacts.length ? unhealthyArtifacts.map((artifact) => [
    `- ${artifact.name} (${artifact.fileName}): ${artifact.warnings.join("; ")}`
  ].join("\n")).join("\n") : "- All required and expected artifacts are present and readable."}

## Report Checks

${reviewed.reportReviews.map((report) => [
    `- ${report.fileName}: ${report.qualityPassed ? "passed" : "warnings"} (${report.qualityScore}/100, ${report.lines} lines)`,
    ...phaseReviewNotes(reviewed.meta?.phases?.find((phase) => phase.id === report.phaseId)).map((warning) => `  - ${warning}`),
    ...report.warnings.map((warning) => `  - ${warning}`)
  ].join("\n")).join("\n")}

## Weak Evidence

${reviewed.weakEvidence.length ? reviewed.weakEvidence.map((finding) => [
    `- ${finding.severity.toUpperCase()} ${finding.id}: ${finding.title}`,
    ...finding.warnings.map((warning) => `  - ${warning}`)
  ].join("\n")).join("\n") : "- None detected."}

## Stale State

${reviewed.staleWarnings.length ? reviewed.staleWarnings.map((warning) => `- ${warning}`).join("\n") : "- No stale state signals detected."}
`;
}

async function inspectArtifactHealth(
  runDir: string,
  meta: AuditMeta | undefined,
  findings: StructuredFinding[],
  structuredReports: StructuredPhaseReport[]
): Promise<ArtifactHealthCheck[]> {
  const exportFormats = new Set(meta?.options?.exportFormats ?? []);
  const outputs = meta?.outputs ?? {};
  const definitions: Array<{
    name: string;
    fileName: string;
    required: boolean;
    validate: (content: string) => string[];
  }> = [
    {
      name: "Summary JSON",
      fileName: "summary.json",
      required: true,
      validate: (content) => validateJsonObject(content, "summary.json")
    },
    {
      name: "Report JSON",
      fileName: "report.json",
      required: true,
      validate: (content) => [
        ...validateJsonObject(content, "report.json"),
        ...validateReportJsonConsistency(content, findings)
      ]
    },
    {
      name: "Findings JSON",
      fileName: "findings.json",
      required: true,
      validate: (content) => validateFindingsJson(content, meta, findings)
    },
    {
      name: "Structured Reports JSON",
      fileName: "structured-reports.json",
      required: true,
      validate: (content) => validateStructuredReportsJson(content, structuredReports)
    },
    {
      name: "Prompt Manifest",
      fileName: "prompt-manifest.json",
      required: true,
      validate: validatePromptManifestJson
    },
    {
      name: "SARIF Export",
      fileName: "findings.sarif",
      required: exportFormats.has("sarif") || Boolean(outputs.findingsSarif),
      validate: validateSarifJson
    },
    {
      name: "HTML Report",
      fileName: "report.html",
      required: exportFormats.has("html") || Boolean(outputs.htmlReport),
      validate: validateHtmlReport
    },
    {
      name: "JSONL Findings",
      fileName: "findings.jsonl",
      required: exportFormats.has("jsonl") || Boolean(outputs.findingsJsonl),
      validate: validateJsonlFindings
    }
  ];

  return Promise.all(definitions.map((definition) => inspectArtifact(runDir, definition)));
}

async function inspectArtifact(
  runDir: string,
  definition: {
    name: string;
    fileName: string;
    required: boolean;
    validate: (content: string) => string[];
  }
): Promise<ArtifactHealthCheck> {
  const filePath = path.join(runDir, definition.fileName);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return {
        name: definition.name,
        fileName: definition.fileName,
        required: definition.required,
        exists: true,
        readable: false,
        valid: false,
        sizeBytes: fileStat.size,
        warnings: [`Artifact path is not a file: ${definition.fileName}`]
      };
    }
    const content = await readFile(filePath, "utf8");
    const warnings = definition.validate(content);
    return {
      name: definition.name,
      fileName: definition.fileName,
      required: definition.required,
      exists: true,
      readable: true,
      valid: warnings.length === 0,
      sizeBytes: fileStat.size,
      warnings
    };
  } catch (error) {
    const missing = Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
    return {
      name: definition.name,
      fileName: definition.fileName,
      required: definition.required,
      exists: false,
      readable: false,
      valid: !definition.required && missing,
      warnings: definition.required ? [`Required artifact is missing: ${definition.fileName}`] : []
    };
  }
}

function validateJsonObject(content: string, label: string): string[] {
  const parsed = parseJson(content);
  if (!parsed.ok) {
    return [`${label} is not valid JSON: ${parsed.error}`];
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return [`${label} must contain a JSON object.`];
  }
  return [];
}

function validateReportJsonConsistency(content: string, findings: StructuredFinding[]): string[] {
  const parsed = parseJson(content);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return [];
  }
  const report = parsed.value as { findings?: unknown };
  if (Array.isArray(report.findings) && report.findings.length !== findings.length) {
    return [`report.json contains ${report.findings.length} finding(s), but findings.json contains ${findings.length}.`];
  }
  return [];
}

function validateFindingsJson(content: string, meta: AuditMeta | undefined, findings: StructuredFinding[]): string[] {
  const parsed = parseJson(content);
  if (!parsed.ok) {
    return [`findings.json is not valid JSON: ${parsed.error}`];
  }
  if (!Array.isArray(parsed.value)) {
    return ["findings.json must contain a JSON array."];
  }
  const warnings: string[] = [];
  if (parsed.value.length !== findings.length) {
    warnings.push(`findings.json parsed count changed during review (${parsed.value.length} vs ${findings.length}).`);
  }
  const metaCount = meta?.findingCounts
    ? Object.values(meta.findingCounts).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0)
    : undefined;
  if (metaCount !== undefined && metaCount !== findings.length) {
    warnings.push(`meta.json findingCounts totals ${metaCount}, but findings.json contains ${findings.length}.`);
  }
  return warnings;
}

function validateStructuredReportsJson(content: string, structuredReports: StructuredPhaseReport[]): string[] {
  const parsed = parseJson(content);
  if (!parsed.ok) {
    return [`structured-reports.json is not valid JSON: ${parsed.error}`];
  }
  if (!Array.isArray(parsed.value)) {
    return ["structured-reports.json must contain a JSON array."];
  }
  const warnings: string[] = [];
  if (parsed.value.length !== structuredReports.length) {
    warnings.push(`structured-reports.json parsed count changed during review (${parsed.value.length} vs ${structuredReports.length}).`);
  }
  if (structuredReports.length < REPORT_FILES.length) {
    warnings.push(`structured-reports.json contains ${structuredReports.length} phase report(s); expected ${REPORT_FILES.length}.`);
  }
  return warnings;
}

function validatePromptManifestJson(content: string): string[] {
  const parsed = parseJson(content);
  if (!parsed.ok) {
    return [`prompt-manifest.json is not valid JSON: ${parsed.error}`];
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return ["prompt-manifest.json must contain a JSON object."];
  }
  const manifest = parsed.value as { phases?: unknown };
  if (!Array.isArray(manifest.phases)) {
    return ["prompt-manifest.json is missing a phases array."];
  }
  if (manifest.phases.length < REPORT_FILES.length) {
    return [`prompt-manifest.json contains ${manifest.phases.length} phase manifest(s); expected ${REPORT_FILES.length}.`];
  }
  return [];
}

function validateSarifJson(content: string): string[] {
  const parsed = parseJson(content);
  if (!parsed.ok) {
    return [`findings.sarif is not valid JSON: ${parsed.error}`];
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return ["findings.sarif must contain a JSON object."];
  }
  const sarif = parsed.value as { version?: unknown; runs?: unknown };
  const warnings: string[] = [];
  if (sarif.version !== "2.1.0") {
    warnings.push("findings.sarif is missing SARIF version 2.1.0.");
  }
  if (!Array.isArray(sarif.runs)) {
    warnings.push("findings.sarif is missing a runs array.");
  }
  return warnings;
}

function validateHtmlReport(content: string): string[] {
  return /<html[\s>]/i.test(content) && /RepoVista/i.test(content)
    ? []
    : ["report.html does not look like a RepoVista HTML report."];
}

function validateJsonlFindings(content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  for (const [index, line] of lines.entries()) {
    const parsed = parseJson(line);
    if (!parsed.ok) {
      warnings.push(`findings.jsonl line ${index + 1} is not valid JSON: ${parsed.error}`);
      break;
    }
  }
  return warnings;
}

function parseJson(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function phaseReviewNotes(phase: PhaseReportStatus | undefined): string[] {
  if (!phase) {
    return [];
  }
  const notes: string[] = [];
  if (phase.status !== "success") {
    notes.push(`Phase status: ${phase.status}${phase.error ? ` (${phase.error})` : ""}`);
  } else if (phase.error) {
    notes.push(`Phase warning: ${phase.error}`);
  }
  if (phase.preservedPreviousReport) {
    notes.push(`Previous valid report preserved after failed retry${phase.retryError ? `: ${phase.retryError}` : "."}`);
  }
  if (phase.repairAttempts?.length) {
    notes.push(`Repair attempts: ${phase.repairAttempts.length}`);
    for (const attempt of phase.repairAttempts) {
      const reason = attempt.warnings.length ? `; reason=${attempt.warnings.join(" | ")}` : "";
      const error = attempt.error ? `; error=${attempt.error}` : "";
      notes.push(`Repair ${attempt.attempt} (${attempt.phaseId}) ${attempt.status} in ${attempt.durationMs}ms${reason}${error}`);
    }
  }
  if (phase.providerRun) {
    const run = phase.providerRun;
    const termination = run.termination
      ? `; termination=${run.termination.reason}, SIGINT=${run.termination.sigintSent ? "sent" : "not sent"}, SIGTERM=${run.termination.sigtermSent ? "sent" : "not sent"}, SIGKILL=${run.termination.sigkillSent ? "sent" : "not sent"}${run.termination.forcedSettle ? ", forced settle" : ""}`
      : "";
    if (run.timedOut || run.interrupted || phase.status === "failed") {
      notes.push(`Provider process: pid=${run.pid ?? "n/a"}, timeout=${run.timeoutSeconds}s, timedOut=${run.timedOut}, interrupted=${run.interrupted}, exit=${run.exitCode ?? "n/a"}, signal=${run.signal ?? "n/a"}${termination}`);
    }
  }
  const failedShards = [...(phase.shards ?? []), ...(phase.deepReviewShards ?? [])].filter((shard) => shard.status === "failed");
  for (const shard of failedShards.slice(0, 5)) {
    const run = shard.providerRun;
    notes.push(`Shard ${shard.id} failed after ${shard.attempts ?? 1} attempt(s): ${shard.error ?? "no error"}${run?.pid ? ` (pid=${run.pid})` : ""}`);
  }
  if (failedShards.length > 5) {
    notes.push(`${failedShards.length - 5} additional shard failure(s) omitted from review output.`);
  }
  return notes;
}

export function renderPrComment(reviewed: ReviewedRun): string {
  const counts = reviewed.meta?.findingCounts ?? countFindings(reviewed.findings);
  const topFindings = reviewed.findings
    .filter((finding) => finding.severity === "critical" || finding.severity === "high")
    .slice(0, 8);
  const qualityWarnings = reviewed.reportReviews.filter((report) => !report.qualityPassed).length;
  return `## RepoVista Report

Run: \`${reviewed.meta?.runId ?? path.basename(reviewed.runDir)}\`
Provider: ${reviewed.meta?.ai.displayName ?? "not recorded"}
Model: ${reviewed.meta?.ai.model ?? "not recorded"}
Reasoning: ${reviewed.meta?.ai.reasoning ?? "not recorded"}
Checks: ${reviewed.meta?.evidence?.checks.enabled ? `${reviewed.meta.evidence.checks.commands.length} command(s)` : "disabled"}

| Severity | Findings |
|---|---:|
| Critical | ${counts.critical ?? 0} |
| High | ${counts.high ?? 0} |
| Medium | ${counts.medium ?? 0} |
| Low | ${counts.low ?? 0} |

Quality warnings: ${qualityWarnings}
Weak evidence findings: ${reviewed.weakEvidence.length}

${topFindings.length ? `### Top Findings\n\n${topFindings.map((finding) => `- ${finding.severity.toUpperCase()}: ${finding.title} (${finding.paths.join(", ") || "no paths"})`).join("\n")}\n` : "No critical or high findings were recorded.\n"}
Artifacts: \`${reviewed.runDir}\`
`;
}

function weakEvidenceFindings(findings: StructuredFinding[]): ReviewedRun["weakEvidence"] {
  return findings
    .map((finding) => {
      const warnings: string[] = [];
      const refs = finding.evidenceDetails?.length
        ? finding.evidenceDetails
        : (finding.evidenceReferences ?? []).map((reference) => typeof reference === "string" ? { path: reference } : reference);
      if (!refs.length) {
        warnings.push("No evidence references.");
      }
      if (refs.some((reference) => !reference.startLine || !reference.endLine)) {
        warnings.push("One or more evidence references have no line range.");
      }
      if (!refs.some((reference) => reference.quote)) {
        warnings.push("No exact evidence quote.");
      }
      if (finding.evidenceValidation && !finding.evidenceValidation.passed) {
        warnings.push(...finding.evidenceValidation.warnings);
      }
      return {
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        warnings
      };
    })
    .filter((finding) => finding.warnings.length);
}

async function staleWarnings(projectRoot: string, meta: AuditMeta | undefined): Promise<string[]> {
  const warnings: string[] = [];
  if (!meta?.evidence?.git.commit) {
    return warnings;
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    const current = stdout.trim();
    if (current && current !== meta.evidence.git.commit) {
      warnings.push(`Run was created for commit ${meta.evidence.git.commit}, current checkout is ${current}. Revalidate findings before acting on them.`);
    }
  } catch {
    // Git drift is an advisory signal only.
  }
  return warnings;
}

function requireRunDir(options: AuditOptions): string {
  if (!options.reportRunDir) {
    throw new RepoVistaError("Command requires a RepoVista run directory.");
  }
  return options.reportRunDir;
}

async function assertDirectory(directory: string): Promise<void> {
  try {
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory()) {
      throw new RepoVistaError(`RepoVista run path is not a directory: ${directory}`);
    }
  } catch (error) {
    if (error instanceof RepoVistaError) {
      throw error;
    }
    throw new RepoVistaError(`RepoVista run path is not readable: ${directory}`);
  }
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function countFindings(findings: StructuredFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    return counts;
  }, {});
}
