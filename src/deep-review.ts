import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractFindings, mergeFindings } from "./findings.js";
import { claimFeature, releaseFeature } from "./feature-state.js";
import { type PhaseDefinition, type PromptContext } from "./prompts.js";
import { findingsSentinelPayload } from "./provider-schema.js";
import { reportPath } from "./reports.js";
import { safeReadReport } from "./resume-manager.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import type {
  AuditOptions,
  PhaseReportStatus,
  ProjectMap,
  ProviderRunResult,
  RunPaths,
  StructuredFinding,
  WorkShard
} from "./types.js";

type RunPhaseFunction = typeof runProviderPhase;

export interface DeepRiskReviewInput {
  phase: PhaseDefinition;
  basePrompt: string;
  context: PromptContext;
  projectRoot: string;
  paths: RunPaths;
  options: AuditOptions;
  projectMap: ProjectMap;
  result: ProviderRunResult;
  status: PhaseReportStatus;
  runPhase: RunPhaseFunction;
  spawnAdapter?: SpawnAdapter;
}

export async function maybeRunDeepRiskReview(input: DeepRiskReviewInput): Promise<ProviderRunResult> {
  if (!input.options.deepReview || input.phase.id !== "risk-and-bug" || !input.result.success) {
    return input.result;
  }

  const shards = deepReviewShards(input.projectMap);
  if (!shards.length) {
    return input.result;
  }

  const startedAt = Date.now();
  const deepDir = path.join(input.paths.runDir, "deep-review", input.phase.id);
  await mkdir(deepDir, { recursive: true });
  input.status.deepReviewShards = shards.map((shard) => ({
    id: shard.id,
    title: shard.title,
    reportFile: path.relative(input.paths.runDir, shardReportPath(deepDir, shard.id)).split(path.sep).join("/"),
    status: "pending"
  }));

  const concurrency = Math.max(1, Math.min(input.options.parallel === "off" ? 2 : Number(input.options.parallel) || 3, shards.length, 5));
  const shardResults = await runWithConcurrency(shards, concurrency, async (shard) => {
    const report = shardReportPath(deepDir, shard.id);
    const shardStatus = input.status.deepReviewShards?.find((item) => item.id === shard.id);
    const claimed = await claimShardFeatures(input, shard).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (shardStatus) {
        shardStatus.status = "failed";
        shardStatus.error = message;
      }
      return { claimed: [] as string[], error: message };
    });
    if ("error" in claimed) {
      return {
        shard,
        result: {
          phaseId: `${input.phase.id}-deep-${shard.id}`,
          success: false,
          reportPath: report,
          durationMs: 0,
          exitCode: 1,
          error: claimed.error
        } satisfies ProviderRunResult
      };
    }
    const result = await input.runPhase({
      provider: input.options.provider ?? "codex",
      phaseId: `${input.phase.id}-deep-${shard.id}`,
      phaseTitle: `${input.phase.title} Deep Review (${shard.title})`,
      prompt: buildDeepReviewPrompt(input.basePrompt, input.context, shard),
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
      timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800
    }, input.spawnAdapter);
    await Promise.all(claimed.claimed.map((featureId) =>
      releaseFeature(
        input.projectRoot,
        input.options.outDir,
        featureId,
        result.success ? "reviewed" : "error",
        result.error,
        new Date()
      )
    ));
    if (shardStatus) {
      shardStatus.status = result.success ? "success" : "failed";
      shardStatus.durationMs = result.durationMs;
      shardStatus.error = result.error;
    }
    return { shard, result };
  });

  const baseReport = await safeReadReport(input.result.reportPath, input.phase.title);
  const shardReports: Record<string, string> = {};
  for (const { shard, result } of shardResults) {
    if (result.success) {
      shardReports[shard.id] = await safeReadReport(result.reportPath, shard.title);
    }
  }

  const mergedFindings = mergeFindings([
    ...extractFindings(baseReport, input.phase.reportFile),
    ...Object.entries(shardReports).flatMap(([shardId, report]) =>
      extractFindings(report, `deep-review/${input.phase.id}/${shardId}.md`)
    )
  ]);
  const finalReportPath = reportPath(input.paths.runDir, input.phase.reportFile);
  await writeFile(finalReportPath, appendDeepReviewAppendix(baseReport, shardReports, mergedFindings), "utf8");

  const failed = shardResults.filter((item) => !item.result.success);
  return {
    phaseId: input.phase.id,
    success: failed.length === 0,
    reportPath: finalReportPath,
    durationMs: input.result.durationMs + Date.now() - startedAt,
    exitCode: failed.length ? 1 : input.result.exitCode,
    error: failed.length ? `${failed.length} deep review shard(s) failed.` : undefined
  };
}

function deepReviewShards(projectMap: ProjectMap): WorkShard[] {
  const featureShards = projectMap.features
    .filter((feature) => feature.ownedFiles.length && !["documentation", "package-script"].includes(feature.kind))
    .slice(0, 5)
    .map((feature, index) => ({
      id: `feature-${index + 1}`,
      title: feature.title,
      description: `${feature.kind} feature`,
      paths: feature.paths,
      primaryLanguages: feature.tags.filter((tag) => /^[a-z+#.]+$/i.test(tag)).slice(0, 5),
      estimatedFiles: feature.ownedFiles.length,
      estimatedBytes: 0,
      focus: `${feature.kind} feature from ${feature.source}; owned files: ${feature.ownedFiles.slice(0, 12).join(", ") || "n/a"}`,
      featureIds: [feature.id],
      validationCommands: feature.validationCommands
    }));
  if (featureShards.length) {
    return featureShards;
  }
  const recommended = projectMap.recommendedShards.length
    ? projectMap.recommendedShards
    : [];
  if (recommended.length > 1) {
    return recommended;
  }
  return projectMap.areas
    .filter((area) => area.paths.length)
    .slice(0, 5)
    .map((area, index) => ({
      id: `feature-${index + 1}`,
      title: area.title,
      description: area.description,
      paths: area.paths,
      primaryLanguages: area.primaryLanguages,
      estimatedFiles: area.fileCount,
      estimatedBytes: area.bytes,
      focus: area.description
    }));
}

async function claimShardFeatures(input: DeepRiskReviewInput, shard: WorkShard): Promise<{ claimed: string[] }> {
  const featureIds = shard.featureIds ?? [];
  const claimed: string[] = [];
  try {
    for (const featureId of featureIds) {
      await claimFeature(input.projectRoot, input.options.outDir, featureId, {
        runId: input.paths.runId,
        command: `deep-review:${input.phase.id}:${shard.id}`,
        pid: process.pid,
        createdAt: new Date().toISOString()
      }, { allowNonPending: true });
      claimed.push(featureId);
    }
    return { claimed };
  } catch (error) {
    await Promise.all(claimed.map((featureId) => releaseFeature(input.projectRoot, input.options.outDir, featureId)));
    throw error;
  }
}

function buildDeepReviewPrompt(basePrompt: string, context: PromptContext, shard: WorkShard): string {
  return `${basePrompt}

Additional feature-sliced deep review assignment:
- This is not the broad repository risk report. Focus only on this shard: ${shard.title}.
- Paths in scope: ${shard.paths.length ? shard.paths.map((item) => `\`${item}\``).join(", ") : "n/a"}.
- Primary languages/signals: ${shard.primaryLanguages.join(", ") || "not detected"}.
- Focus notes: ${shard.focus}
- Prefer concrete, atomic findings over broad themes.
- If a broader theme appears, include it as a parent finding with childFindings for atomic fixes.
- Include reproduction, suggestedRegressionTest, minimumFixScope, and exact evidenceReferences with path/startLine/endLine/quote.
- Return a concise Markdown shard report in ${context.language}; include the repovista-findings sentinel JSON block.
`;
}

function appendDeepReviewAppendix(
  baseReport: string,
  shardReports: Record<string, string>,
  findings: StructuredFinding[]
): string {
  const shardLinks = Object.keys(shardReports).map((id) => `- ${id}: deep-review/risk-and-bug/${id}.md`).join("\n");
  return `${baseReport.trim()}

# Feature-Sliced Deep Review

RepoVista ran additional read-only risk-review passes for project shards and merged/deduplicated the findings below.

${shardLinks || "- No successful deep-review shard reports."}

<!-- repovista-findings:start -->
${JSON.stringify(findingsSentinelPayload(findings), null, 2)}
<!-- repovista-findings:end -->
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
