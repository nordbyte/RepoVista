import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ANALYSIS_PHASES, type PhaseDefinition } from "./prompts.js";
import { validateReportQuality } from "./quality-gates.js";
import { readReport, reportPath } from "./reports.js";
import type { AuditMeta, AuditOptions, PhaseReportStatus, RunPaths } from "./types.js";

export async function readPreviousMeta(runDir: string): Promise<AuditMeta | undefined> {
  try {
    const raw = await readFile(path.join(runDir, "meta.json"), "utf8");
    const parsed = JSON.parse(raw) as AuditMeta;
    if (parsed && Array.isArray(parsed.phases)) {
      return parsed;
    }
  } catch {
    // Runs without usable metadata are resumable directories but do not provide reusable phase artifacts.
  }
  return undefined;
}

export async function loadExistingReports(
  paths: RunPaths,
  previousReports: Record<string, string>,
  statuses: PhaseReportStatus[],
  previousMeta: AuditMeta | undefined
): Promise<void> {
  for (const phase of ANALYSIS_PHASES) {
    const previousStatus = findPreviousPhaseStatus(previousMeta, phase.id);
    const filePath = reportPath(paths.runDir, phase.reportFile);
    try {
      const content = await readReport(filePath);
      if (!isReusablePhaseReport(phase.id, content)) {
        continue;
      }
      previousReports[phase.reportFile] = content;
      const status = phaseStatus(statuses, phase);
      status.status = "success";
      status.durationMs = previousStatus?.durationMs;
      status.shards = previousStatus?.shards;
      status.deepReviewShards = previousStatus?.deepReviewShards;
      status.providerRun = previousStatus?.providerRun;
      applyReportQuality(status, phase.id, content, false);
    } catch {
      // Missing reports are normal for an interrupted run.
    }
  }
}

export function expandSelectedPhases(phases: string[]): Set<string> | undefined {
  if (!phases.length || phases.includes("all")) {
    return undefined;
  }
  return new Set(phases);
}

export async function shouldRunPhase(
  phase: PhaseDefinition,
  status: PhaseReportStatus,
  paths: RunPaths,
  options: AuditOptions,
  selectedPhases: Set<string> | undefined,
  detailPhaseRan: boolean
): Promise<boolean> {
  if (selectedPhases) {
    return selectedPhases.has(phase.id) || selectedPhases.has(phase.reportFile);
  }

  if (!options.resumeDir) {
    return true;
  }

  const existingSuccess = status.status === "success" && await pathExists(reportPath(paths.runDir, phase.reportFile));
  if (phase.id === "summary") {
    return detailPhaseRan || !existingSuccess;
  }
  return !existingSuccess;
}

export async function markSkippedOrPreserved(
  status: PhaseReportStatus,
  phase: PhaseDefinition,
  paths: RunPaths,
  previousReports: Record<string, string>
): Promise<void> {
  const filePath = reportPath(paths.runDir, phase.reportFile);
  const content = previousReports[phase.reportFile];
  if (content) {
    previousReports[phase.reportFile] = content;
    status.status = status.status === "success" ? "success" : "skipped";
    applyReportQuality(status, phase.id, content, false);
    return;
  }
  if (await pathExists(filePath) && status.status === "success") {
    return;
  }
  status.status = "skipped";
}

export function phaseStatus(statuses: PhaseReportStatus[], phase: PhaseDefinition): PhaseReportStatus {
  const status = statuses.find((item) => item.id === phase.id);
  if (status) {
    return status;
  }
  const created: PhaseReportStatus = {
    id: phase.id,
    title: phase.title,
    reportFile: phase.reportFile,
    status: "pending"
  };
  statuses.push(created);
  return created;
}

export async function updatePhaseStatus(
  status: PhaseReportStatus,
  phase: PhaseDefinition,
  result: {
    success: boolean;
    durationMs: number;
    error?: string;
    reportPath: string;
    diagnostics?: PhaseReportStatus["providerRun"];
    preservedPreviousReport?: boolean;
    retryError?: string;
    retryDurationMs?: number;
  },
  strictReports: boolean
): Promise<void> {
  status.status = result.success ? "success" : "failed";
  status.durationMs = result.durationMs;
  status.providerRun = result.diagnostics;
  status.preservedPreviousReport = result.preservedPreviousReport;
  status.retryError = result.retryError;
  status.retryDurationMs = result.retryDurationMs;
  if (result.error) {
    status.error = result.error;
  } else if (!result.retryError) {
    status.error = undefined;
  }

  if (!result.success) {
    return;
  }

  const content = await safeReadReport(result.reportPath, phase.title);
  applyReportQuality(status, phase.id, content, strictReports);
}

export function applyReportQuality(status: PhaseReportStatus, phaseId: string, content: string, strictReports: boolean): void {
  const quality = validateReportQuality(phaseId, content);
  status.qualityPassed = quality.passed;
  status.qualityWarnings = quality.warnings;
  status.qualityScore = quality.score;
  if (!quality.passed && strictReports) {
    status.status = "failed";
    status.error = `Report quality gate failed: ${quality.warnings.join(" ")}`;
  }
}

export async function safeReadReport(filePath: string, title: string): Promise<string> {
  try {
    return await readReport(filePath);
  } catch {
    return `# ${title}\n\nReport could not be read.`;
  }
}

export function findPreviousPhaseStatus(meta: AuditMeta | undefined, phaseId: string): PhaseReportStatus | undefined {
  return meta?.phases.find((phase) => phase.id === phaseId);
}

export function isReusablePhaseReport(phaseId: string, content: string): boolean {
  if (!content.trim() || isProviderFailureReport(content)) {
    return false;
  }
  return validateReportQuality(phaseId, content).passed;
}

export async function canReuseShardReport(
  runDir: string,
  report: string,
  previousStatus: PhaseReportStatus | undefined,
  shardId: string
): Promise<boolean> {
  const previousShard = previousStatus?.shards?.find((item) => item.id === shardId);
  const relativeReport = path.relative(runDir, report).split(path.sep).join("/");
  if (previousShard?.status !== "success" || previousShard.reportFile !== relativeReport) {
    return false;
  }

  try {
    const content = await readReport(report);
    return Boolean(content.trim()) && !isProviderFailureReport(content);
  } catch {
    return false;
  }
}

function isProviderFailureReport(content: string): boolean {
  return /^## Status\s*$/im.test(content) && /^Failed\.\s*$/im.test(content);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
