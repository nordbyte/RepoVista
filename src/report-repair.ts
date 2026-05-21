import { readFile } from "node:fs/promises";
import { validateFindingsEvidence } from "./evidence-validation.js";
import { extractFindingsWithSource } from "./findings.js";
import { type PhaseDefinition } from "./prompts.js";
import { validateReportQuality } from "./quality-gates.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { getReportProvider } from "./providers/index.js";
import { schemaForPhase, structuredPromptForPhase } from "./provider-schema.js";
import type { AuditOptions, PhaseRepairAttempt, ProviderRunResult, RunPaths } from "./types.js";

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
  abortSignal?: AbortSignal;
  onRepairAttempt?: (attempt: {
    attempt: number;
    phaseId: string;
    phaseTitle: string;
    warnings: string[];
  }) => void;
}

export async function maybeRepairPhaseReport(input: RepairPhaseInput): Promise<ProviderRunResult> {
  if (!input.result.success) {
    return input.result;
  }

  let currentResult = input.result;
  let repairAttempts = [...(input.result.repairAttempts ?? [])];
  const configuredAttempts = input.options.repairReports ? input.options.repairAttempts ?? 1 : 0;
  const attempts = Math.max(0, Math.min(3, Math.max(configuredAttempts, input.phase.id === "risk-and-bug" ? 1 : 0)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const currentReport = await safeRead(currentResult.reportPath);
    const warnings = await repairWarnings(input, currentReport);
    if (!warnings.length) {
      return repairAttempts.length ? repairedPhaseResult(input.result, currentResult, repairAttempts) : currentResult;
    }

    const repairPhaseId = `${input.phase.id}-repair-${attempt}`;
    const repairPhaseTitle = `${input.phase.title} Repair ${attempt}`;
    input.onRepairAttempt?.({
      attempt,
      phaseId: repairPhaseId,
      phaseTitle: repairPhaseTitle,
      warnings
    });

    const repairRequest = buildRepairRequest(input, repairPhaseId, repairPhaseTitle, currentReport, warnings);
    const repairResult = await input.runPhase({
      provider: input.options.provider ?? "codex",
      phaseId: repairPhaseId,
      phaseTitle: repairPhaseTitle,
      prompt: repairRequest.prompt,
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
      timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800,
      outputSchema: repairRequest.outputSchema,
      outputSchemaKind: repairRequest.outputSchemaKind,
      abortSignal: input.abortSignal
    }, input.spawnAdapter);
    const repairAttempt: PhaseRepairAttempt = {
      attempt,
      phaseId: repairResult.phaseId,
      status: repairResult.success ? "success" : "failed",
      warnings,
      durationMs: repairResult.durationMs,
      error: repairResult.error,
      providerRun: repairResult.diagnostics
    };
    repairAttempts = [...repairAttempts, repairAttempt];
    currentResult = {
      ...repairResult,
      repairAttempts
    };

    if (!currentResult.success) {
      return repairedPhaseResult(input.result, currentResult, repairAttempts);
    }
  }

  return repairAttempts.length ? repairedPhaseResult(input.result, currentResult, repairAttempts) : currentResult;
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
- Every kept risk finding must include at least one evidence reference with a non-empty exact quote copied from the referenced file and line range. If an exact quote is uncertain, remove that evidence reference or drop the unsupported finding instead of keeping it without a quote.
- Do not claim checks were not run when the Evidence Pack contains check results.
- Keep the report read-only and return only the corrected Markdown report.

Quality gate warnings to fix:
${warnings.map((warning) => `- ${warning}`).join("\n")}

Current report to repair:

${currentReport}
`;
}

function buildRepairRequest(
  input: RepairPhaseInput,
  repairPhaseId: string,
  repairPhaseTitle: string,
  currentReport: string,
  warnings: string[]
): {
  prompt: string;
  outputSchema?: Record<string, unknown>;
  outputSchemaKind?: "risk-report" | "phase-report";
} {
  const prompt = buildRepairPrompt(input.phase, input.originalPrompt, currentReport, warnings);
  const provider = getReportProvider(input.options.provider ?? "codex");
  const schema = schemaForPhase(input.phase.id);
  if (!schema || !provider.capabilities.outputSchema) {
    return { prompt };
  }
  return {
    prompt: structuredPromptForPhase(input.phase.id, `${prompt}

Repair output identity:
- This is repair run ${repairPhaseId} (${repairPhaseTitle}), but the structured JSON "phaseId" must remain "${input.phase.id}".
`),
    outputSchema: schema.schema,
    outputSchemaKind: schema.kind
  };
}

function repairedPhaseResult(
  originalResult: ProviderRunResult,
  currentResult: ProviderRunResult,
  repairAttempts: PhaseRepairAttempt[]
): ProviderRunResult {
  return {
    ...originalResult,
    success: currentResult.success,
    reportPath: currentResult.reportPath,
    exitCode: currentResult.success ? originalResult.exitCode : currentResult.exitCode,
    error: currentResult.success ? originalResult.error : currentResult.error,
    structuredOutputPath: currentResult.structuredOutputPath ?? originalResult.structuredOutputPath,
    repairAttempts
  };
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
