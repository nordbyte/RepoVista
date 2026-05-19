import { readFile } from "node:fs/promises";
import { validateFindingsEvidence } from "./evidence-validation.js";
import { extractFindingsWithSource } from "./findings.js";
import { type PhaseDefinition } from "./prompts.js";
import { validateReportQuality } from "./quality-gates.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import type { AuditOptions, ProviderRunResult, RunPaths } from "./types.js";

type RunPhaseFunction = typeof runProviderPhase;

export interface RepairPhaseInput {
  phase: PhaseDefinition;
  originalPrompt: string;
  result: ProviderRunResult;
  projectRoot: string;
  paths: RunPaths;
  options: AuditOptions;
  runPhase: RunPhaseFunction;
  spawnAdapter?: SpawnAdapter;
}

export async function maybeRepairPhaseReport(input: RepairPhaseInput): Promise<ProviderRunResult> {
  if (!input.result.success) {
    return input.result;
  }

  let currentResult = input.result;
  const configuredAttempts = input.options.repairReports ? input.options.repairAttempts ?? 1 : 0;
  const attempts = Math.max(0, Math.min(3, Math.max(configuredAttempts, input.phase.id === "risk-and-bug" ? 1 : 0)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const currentReport = await safeRead(currentResult.reportPath);
    const warnings = await repairWarnings(input, currentReport);
    if (!warnings.length) {
      return currentResult;
    }

    currentResult = await input.runPhase({
      provider: input.options.provider ?? "codex",
      phaseId: `${input.phase.id}-repair-${attempt}`,
      phaseTitle: `${input.phase.title} Repair ${attempt}`,
      prompt: buildRepairPrompt(input.phase, input.originalPrompt, currentReport, warnings),
      projectRoot: input.projectRoot,
      reportPath: currentResult.reportPath,
      logsDir: input.paths.logsDir,
      model: input.options.model,
      profile: input.options.profile,
      reasoning: input.options.reasoning,
      fastMode: input.options.fastMode,
      sandbox: input.options.sandbox,
      jsonEvents: input.options.json,
      keepLogs: input.options.keepLogs,
      timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800
    }, input.spawnAdapter);

    if (!currentResult.success) {
      return currentResult;
    }
  }

  return currentResult;
}

async function repairWarnings(input: RepairPhaseInput, currentReport: string): Promise<string[]> {
  const quality = validateReportQuality(input.phase.id, currentReport);
  const warnings = [...quality.warnings];
  if (input.phase.id !== "risk-and-bug") {
    return input.options.repairReports ? warnings : [];
  }

  const extraction = extractFindingsWithSource(currentReport);
  if (!extraction.schemaFound) {
    warnings.push("Risk findings schema is missing or invalid; rewrite the report with a valid repovista-findings sentinel JSON block.");
    return Array.from(new Set(warnings));
  }
  const validated = await validateFindingsEvidence(input.projectRoot, extraction.findings, undefined);
  for (const finding of validated) {
    if (!finding.evidenceValidation?.passed) {
      warnings.push(
        `Finding ${finding.title} has invalid evidence: ${finding.evidenceValidation?.warnings.join(" ")}`
      );
    }
  }
  return Array.from(new Set(warnings));
}

function buildRepairPrompt(
  phase: PhaseDefinition,
  originalPrompt: string,
  currentReport: string,
  warnings: string[]
): string {
  return `${originalPrompt}

Additional RepoVista repair task:
- Rewrite the ${phase.title} so it satisfies the report quality gates below.
- Preserve accurate findings, recommendations, and concrete path evidence.
- For risk findings, use the repovista-findings sentinel JSON block and include title, severity, category, status, signature, affectedPaths, evidence, evidenceReferences with path/startLine/endLine/quote, problemRationale, recommendedFix, reproduction, suggestedRegressionTest, minimumFixScope, estimatedEffort, and confidence.
- Avoid Markdown code fences around the RepoVista JSON sentinel block.
- Exact evidence quotes must be copied from the referenced file and line range. If an exact quote is uncertain, omit the quote and choose a safer line range.
- Do not claim checks were not run when the Evidence Pack contains check results.
- Keep the report read-only and return only the corrected Markdown report.

Quality gate warnings to fix:
${warnings.map((warning) => `- ${warning}`).join("\n")}

Current report to repair:

${currentReport}
`;
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
