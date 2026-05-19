import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeStructuredOutputs } from "./audit-outputs.js";
import { RepoVistaError } from "./errors.js";
import { validateFindingsEvidence } from "./evidence-validation.js";
import { extractFindings } from "./findings.js";
import { extractStructuredPhaseReport } from "./phase-schema.js";
import { allowedEvidencePathsFromPromptManifest } from "./prompt-manifest.js";
import { renderStructuredProviderOutput } from "./provider-schema.js";
import { ANALYSIS_PHASES } from "./prompts.js";
import { validateReportQuality } from "./quality-gates.js";
import { reportPath, validateReportRoot, writeMarkdownReport, writeMeta } from "./reports.js";
import type {
  AuditMeta,
  AuditOptions,
  EvidencePack,
  PhaseReportStatus,
  PromptManifest,
  RunPaths
} from "./types.js";

interface RepairedReport {
  phaseId: string;
  reportFile: string;
  structuredFile: string;
  status: "repaired" | "preserved" | "missing-structured-json" | "failed";
  qualityPassed: boolean;
  qualityScore: number;
  warnings: string[];
}

interface RepairRunResult {
  runDir: string;
  runId: string;
  repairedReports: RepairedReport[];
  findings: number;
  exitCode: number;
  warnings: string[];
}

export async function runRepairRunCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const runDirOption = requireRunDir(options);
  const runDir = path.resolve(projectRoot, runDirOption);
  await assertDirectory(runDir);
  const meta = await readRequiredJson<AuditMeta>(path.join(runDir, "meta.json"), "meta.json");
  const outRoot = await validateReportRoot(projectRoot, meta.options?.outDir ?? options.outDir);
  assertInside(outRoot, runDir, "Run directory", "report root");

  const promptManifest = await readJson<PromptManifest>(path.join(runDir, "prompt-manifest.json")) ??
    fallbackPromptManifest(meta, now);
  const paths: RunPaths = {
    outRoot,
    runDir,
    runId: meta.runId ?? path.basename(runDir)
  };

  const repairedReports: RepairedReport[] = [];
  const reportContents = new Map<string, string>();
  for (const phase of ANALYSIS_PHASES) {
    const result = await repairPhaseReport({
      phaseId: phase.id,
      reportFile: phase.reportFile,
      runDir,
      force: Boolean(options.force)
    });
    repairedReports.push(result);
    const content = await readText(path.join(runDir, phase.reportFile));
    if (content) {
      reportContents.set(phase.reportFile, content);
    }
  }

  const riskReport = reportContents.get("03-risk-and-bug-report.md") ?? "";
  const extractedFindings = extractFindings(riskReport);
  const findings = await validateFindingsEvidence(
    meta.projectRoot ?? projectRoot,
    extractedFindings,
    allowedEvidencePathsFromPromptManifest(promptManifest, "risk-and-bug")
  );
  const structuredReports = ANALYSIS_PHASES.map((phase) => extractStructuredPhaseReport(
    reportContents.get(phase.reportFile) ?? "",
    phase.id,
    phase.reportFile
  ));
  const phases = ANALYSIS_PHASES.map<PhaseReportStatus>((phase) => {
    const current = meta.phases?.find((item) => item.id === phase.id);
    const result = repairedReports.find((item) => item.phaseId === phase.id);
    return {
      ...current,
      id: phase.id,
      title: phase.title,
      reportFile: phase.reportFile,
      status: result?.qualityPassed ? "success" : "failed",
      error: result?.warnings.length ? result.warnings.join(" ") : current?.error,
      qualityPassed: result?.qualityPassed ?? false,
      qualityWarnings: result?.warnings ?? [],
      qualityScore: result?.qualityScore ?? 0,
      preservedPreviousReport: current?.preservedPreviousReport || result?.status === "preserved" || undefined
    };
  });
  meta.phases = phases;
  meta.findings = findings;
  meta.completedAt = now.toISOString();
  meta.exitCode = phases.some((phase) => phase.status === "failed") ? 1 : 0;
  meta.options.exportFormats = meta.options.exportFormats ?? [];

  await writeStructuredOutputs(
    paths,
    meta,
    findings,
    meta.evidence ?? fallbackEvidence(meta, projectRoot, now),
    promptManifest,
    meta.outputs?.featuresJson ?? reportPath(runDir, "features.json"),
    structuredReports,
    meta.suppressedFindings ?? []
  );
  await writeMeta(runDir, meta);

  const result: RepairRunResult = {
    runDir,
    runId: paths.runId,
    repairedReports,
    findings: findings.length,
    exitCode: meta.exitCode,
    warnings: repairedReports.flatMap((report) => report.warnings.map((warning) => `${report.reportFile}: ${warning}`))
  };

  if (options.json) {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  return renderRepairRunResult(result);
}

async function repairPhaseReport(input: {
  phaseId: string;
  reportFile: string;
  runDir: string;
  force: boolean;
}): Promise<RepairedReport> {
  const structuredFile = input.reportFile.replace(/\.md$/, ".structured.json");
  const structuredPath = path.join(input.runDir, structuredFile);
  const reportPathValue = path.join(input.runDir, input.reportFile);
  const existingReport = await readText(reportPathValue);
  const existingQuality = existingReport ? validateReportQuality(input.phaseId, existingReport) : undefined;
  const rawStructured = await readText(structuredPath);
  if (!rawStructured) {
    return {
      phaseId: input.phaseId,
      reportFile: input.reportFile,
      structuredFile,
      status: "missing-structured-json",
      qualityPassed: existingQuality?.passed ?? false,
      qualityScore: existingQuality?.score ?? 0,
      warnings: existingQuality?.warnings.length
        ? [`Structured JSON is missing; existing report has warnings: ${existingQuality.warnings.join(" ")}`]
        : ["Structured JSON is missing."]
    };
  }

  let rendered = "";
  try {
    rendered = renderStructuredProviderOutput(input.phaseId === "risk-and-bug" ? "risk-report" : "phase-report", rawStructured);
  } catch (error) {
    return {
      phaseId: input.phaseId,
      reportFile: input.reportFile,
      structuredFile,
      status: "failed",
      qualityPassed: existingQuality?.passed ?? false,
      qualityScore: existingQuality?.score ?? 0,
      warnings: [`Could not render structured JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  const renderedQuality = validateReportQuality(input.phaseId, rendered);
  if (!renderedQuality.passed && !input.force) {
    return {
      phaseId: input.phaseId,
      reportFile: input.reportFile,
      structuredFile,
      status: existingQuality?.passed ? "preserved" : "failed",
      qualityPassed: existingQuality?.passed ?? false,
      qualityScore: existingQuality?.score ?? renderedQuality.score,
      warnings: [`Rendered structured report did not pass quality gates: ${renderedQuality.warnings.join(" ")}`]
    };
  }

  await writeMarkdownReport(reportPathValue, rendered);
  return {
    phaseId: input.phaseId,
    reportFile: input.reportFile,
    structuredFile,
    status: renderedQuality.passed ? "repaired" : "failed",
    qualityPassed: renderedQuality.passed,
    qualityScore: renderedQuality.score,
    warnings: renderedQuality.warnings
  };
}

function renderRepairRunResult(result: RepairRunResult): string {
  const repaired = result.repairedReports.filter((report) => report.status === "repaired").length;
  const failed = result.repairedReports.filter((report) => report.status === "failed").length;
  const missing = result.repairedReports.filter((report) => report.status === "missing-structured-json").length;
  return `RepoVista repair-run completed.

Run: ${result.runId}
Directory: ${result.runDir}
Reports repaired: ${repaired}
Reports failed: ${failed}
Structured JSON missing: ${missing}
Findings regenerated: ${result.findings}
Exit code recorded in meta.json: ${result.exitCode}

${result.repairedReports.map((report) => `- ${report.reportFile}: ${report.status} (${report.qualityScore}/100)${report.warnings.length ? ` - ${report.warnings.join("; ")}` : ""}`).join("\n")}
`;
}

function fallbackPromptManifest(meta: AuditMeta, now: Date): PromptManifest {
  return {
    schemaVersion: 1,
    runId: meta.runId,
    createdAt: now.toISOString(),
    features: [],
    phases: []
  };
}

function fallbackEvidence(meta: AuditMeta, projectRoot: string, now: Date): EvidencePack {
  return {
    collectedAt: now.toISOString(),
    projectRoot: meta.projectRoot ?? projectRoot,
    runtime: {
      node: process.version,
      npm: "unknown",
      platform: process.platform
    },
    git: {
      available: false
    },
    codex: {
      available: false
    },
    aiProvider: {
      id: meta.ai?.provider ?? meta.options?.provider ?? "codex",
      displayName: meta.ai?.displayName ?? "not recorded",
      executable: meta.ai?.executable ?? "",
      available: false
    },
    checks: {
      enabled: false,
      timeoutSeconds: 0,
      commands: [],
      results: []
    }
  };
}

function requireRunDir(options: AuditOptions): string {
  if (!options.reportRunDir) {
    throw new RepoVistaError("Command repair-run requires a RepoVista run directory.");
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

function assertInside(baseDirectory: string, targetPath: string, label: string, baseLabel: string): void {
  const relative = path.relative(path.resolve(baseDirectory), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RepoVistaError(`${label} must be inside the ${baseLabel}: ${targetPath}`);
  }
}

async function readRequiredJson<T>(filePath: string, label: string): Promise<T> {
  const parsed = await readJson<T>(filePath);
  if (!parsed) {
    throw new RepoVistaError(`Could not read required RepoVista artifact: ${label}`);
  }
  return parsed;
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
