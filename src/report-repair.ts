import { readFile } from "node:fs/promises";
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
  if (!input.result.success || !input.options.repairReports) {
    return input.result;
  }

  let currentResult = input.result;
  const attempts = Math.max(0, Math.min(3, input.options.repairAttempts ?? 1));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const currentReport = await safeRead(currentResult.reportPath);
    const quality = validateReportQuality(input.phase.id, currentReport);
    if (quality.passed) {
      return currentResult;
    }

    currentResult = await input.runPhase({
      provider: input.options.provider ?? "codex",
      phaseId: `${input.phase.id}-repair-${attempt}`,
      phaseTitle: `${input.phase.title} Repair ${attempt}`,
      prompt: buildRepairPrompt(input.phase, input.originalPrompt, currentReport, quality.warnings),
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
