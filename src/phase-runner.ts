import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type PhaseDefinition, type PromptContext } from "./prompts.js";
import { reportPath } from "./reports.js";
import { canReuseShardReport, safeReadReport } from "./resume-manager.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { getReportProvider } from "./providers/index.js";
import { schemaForPhase, structuredRiskPrompt } from "./provider-schema.js";
import type {
  AuditOptions,
  ParallelExecutionMeta,
  PhaseReportStatus,
  ProviderRunResult,
  RunPaths
} from "./types.js";

type RunPhaseFunction = typeof runProviderPhase;

export interface SinglePhaseInput {
  phase: PhaseDefinition;
  prompt: string;
  projectRoot: string;
  phaseReportPath: string;
  paths: RunPaths;
  options: AuditOptions;
  runPhase: RunPhaseFunction;
  spawnAdapter?: SpawnAdapter;
}

export interface ParallelPhaseInput {
  phase: PhaseDefinition;
  prompt: string;
  context: PromptContext;
  projectRoot: string;
  paths: RunPaths;
  options: AuditOptions;
  parallel: ParallelExecutionMeta;
  runPhase: RunPhaseFunction;
  spawnAdapter?: SpawnAdapter;
  resume: boolean;
  status: PhaseReportStatus;
  previousStatus?: PhaseReportStatus;
}

export async function runSinglePhase(input: SinglePhaseInput): Promise<ProviderRunResult> {
  const structured = structuredRequest(input.options, input.phase.id, input.prompt);
  return input.runPhase({
    provider: input.options.provider ?? "codex",
    phaseId: input.phase.id,
    phaseTitle: input.phase.title,
    prompt: structured.prompt,
    projectRoot: input.projectRoot,
    reportPath: input.phaseReportPath,
    logsDir: input.paths.logsDir,
    model: input.options.model,
    profile: input.options.profile,
    reasoning: input.options.reasoning,
    fastMode: input.options.fastMode,
    sandbox: input.options.sandbox,
    jsonEvents: input.options.json,
    keepLogs: input.options.keepLogs,
    timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800,
    outputSchema: structured.outputSchema,
    outputSchemaKind: structured.outputSchemaKind
  }, input.spawnAdapter);
}

export async function runParallelPhase(input: ParallelPhaseInput): Promise<ProviderRunResult> {
  const startedAt = Date.now();
  const shardDirectory = path.join(input.paths.runDir, "shards", input.phase.id);
  await mkdir(shardDirectory, { recursive: true });
  input.status.shards = input.parallel.shards.map((shard) => ({
    id: shard.id,
    title: shard.title,
    reportFile: path.relative(input.paths.runDir, shardReportPath(shardDirectory, shard.id)).split(path.sep).join("/"),
    status: "pending"
  }));

  const shardResults = await runWithConcurrency(input.parallel.shards, input.parallel.effectiveParallelism, async (shard) => {
    const report = shardReportPath(shardDirectory, shard.id);
    const shardStatus = input.status.shards?.find((item) => item.id === shard.id);
    if (input.resume && await canReuseShardReport(input.paths.runDir, report, input.previousStatus, shard.id)) {
      if (shardStatus) {
        shardStatus.status = "success";
        shardStatus.durationMs = 0;
      }
      return {
        shard,
        result: {
          phaseId: `${input.phase.id}-${shard.id}`,
          success: true,
          reportPath: report,
          durationMs: 0,
          exitCode: 0
        } satisfies ProviderRunResult
      };
    }

    const shardPrompt = buildShardPrompt(input.prompt, shard);
    const structured = structuredRequest(input.options, input.phase.id, shardPrompt);
    const result = await input.runPhase({
      provider: input.options.provider ?? "codex",
      phaseId: `${input.phase.id}-${shard.id}`,
      phaseTitle: `${input.phase.title} (${shard.title})`,
      prompt: structured.prompt,
      projectRoot: input.projectRoot,
      reportPath: report,
      logsDir: input.paths.logsDir,
      model: input.options.model,
      profile: input.options.profile,
      reasoning: input.options.reasoning,
      fastMode: input.options.fastMode,
      sandbox: input.options.sandbox,
      jsonEvents: input.options.json,
      keepLogs: input.options.keepLogs,
      timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800,
      outputSchema: structured.outputSchema,
      outputSchemaKind: structured.outputSchemaKind
    }, input.spawnAdapter);
    if (shardStatus) {
      shardStatus.status = result.success ? "success" : "failed";
      shardStatus.durationMs = result.durationMs;
      shardStatus.error = result.error;
    }
    return { shard, result };
  });

  const failed = shardResults.filter((item) => !item.result.success);
  const finalReportPath = reportPath(input.paths.runDir, input.phase.reportFile);
  if (failed.length) {
    await writeFile(finalReportPath, renderFailedShardReport(input.phase, failed), "utf8");
    return {
      phaseId: input.phase.id,
      success: false,
      reportPath: finalReportPath,
      durationMs: Date.now() - startedAt,
      exitCode: 1,
      error: `${failed.length} shard(s) failed.`
    };
  }

  const shardReports: Record<string, string> = {};
  for (const { shard, result } of shardResults) {
    shardReports[shard.id] = await safeReadReport(result.reportPath, shard.title);
  }

  const synthesisPrompt = buildSynthesisPrompt(input.phase, input.context, input.prompt, shardReports);
  const structured = structuredRequest(input.options, input.phase.id, synthesisPrompt);
  return input.runPhase({
    provider: input.options.provider ?? "codex",
    phaseId: `${input.phase.id}-synthesis`,
    phaseTitle: `${input.phase.title} Synthesis`,
    prompt: structured.prompt,
    projectRoot: input.projectRoot,
    reportPath: finalReportPath,
    logsDir: input.paths.logsDir,
    model: input.options.model,
    profile: input.options.profile,
    reasoning: input.options.reasoning,
    fastMode: input.options.fastMode,
    sandbox: input.options.sandbox,
    jsonEvents: input.options.json,
    keepLogs: input.options.keepLogs,
    timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800,
    outputSchema: structured.outputSchema,
    outputSchemaKind: structured.outputSchemaKind
  }, input.spawnAdapter);
}

export function canParallelizePhase(phase: PhaseDefinition): boolean {
  return phase.id !== "summary";
}

function buildShardPrompt(basePrompt: string, shard: ParallelExecutionMeta["shards"][number]): string {
  return `${basePrompt}

Shard assignment:
- You are one parallel RepoVista worker for this phase.
- Focus on this shard only: ${shard.title}.
- Paths in scope: ${shard.paths.length ? shard.paths.map((item) => `\`${item}\``).join(", ") : "the whole project"}.
- Primary languages/signals: ${shard.primaryLanguages.join(", ") || "not detected"}.
- Focus notes: ${shard.focus}
- Mention cross-shard questions when you see them, but do not attempt to fully cover paths outside your assignment.
- Return a shard-level Markdown report with concrete evidence for this assignment.
`;
}

function buildSynthesisPrompt(
  phase: PhaseDefinition,
  context: PromptContext,
  basePrompt: string,
  shardReports: Record<string, string>
): string {
  const reports = Object.entries(shardReports)
    .map(([id, content]) => `## Shard ${id}\n\n${content}`)
    .join("\n\n");
  return `${basePrompt}

Additional task: synthesize the final ${phase.title} from the parallel shard reports below.

Rules:
- Produce the final report requested by the original task, not a meta-summary of the workers.
- Resolve duplicates across shards.
- Call out cross-shard risks or architecture patterns when supported by the shard reports.
- Keep concrete file/path evidence.
- Write the final report in ${context.language}.
- Return only the final Markdown report.

Parallel shard reports:

${reports}
`;
}

function renderFailedShardReport(
  phase: PhaseDefinition,
  failed: Array<{ shard: ParallelExecutionMeta["shards"][number]; result: ProviderRunResult }>
): string {
  const rows = failed.map(({ shard, result }) => `- ${shard.id} (${shard.title}): ${result.error ?? "failed"}`);
  return `# ${phase.title}

## Status

Failed.

## Failed Parallel Shards

${rows.join("\n")}
`;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }));
  return results;
}

function shardReportPath(shardDirectory: string, shardId: string): string {
  return path.join(shardDirectory, `${shardId}.md`);
}

function structuredRequest(
  options: AuditOptions,
  phaseId: string,
  prompt: string
): { prompt: string; outputSchema?: Record<string, unknown>; outputSchemaKind?: "risk-report" } {
  const provider = getReportProvider(options.provider ?? "codex");
  const schema = schemaForPhase(phaseId);
  if (!schema || !provider.capabilities.outputSchema) {
    return { prompt };
  }
  return {
    prompt: structuredRiskPrompt(prompt),
    outputSchema: schema.schema,
    outputSchemaKind: schema.kind
  };
}
