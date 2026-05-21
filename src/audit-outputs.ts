import { hasFailedChecks } from "./evidence.js";
import { writeFindingExports } from "./exporters.js";
import { featureStateDirectory } from "./feature-state.js";
import { writeFindingState } from "./finding-state.js";
import { findingCountsBySeverity } from "./findings.js";
import { reportPath, writeJsonFile } from "./reports.js";
import type {
  AuditMeta,
  EvidencePack,
  PhaseReportStatus,
  PromptManifest,
  ProviderUsageTelemetry,
  RunPaths,
  StructuredPhaseReport,
  StructuredFinding,
  RunAnalytics
} from "./types.js";

export async function writeStructuredOutputs(
  paths: RunPaths,
  meta: AuditMeta,
  findings: StructuredFinding[],
  evidence: EvidencePack,
  promptManifest: PromptManifest,
  featuresPath: string,
  structuredReports: StructuredPhaseReport[] = [],
  suppressedFindings: StructuredFinding[] = [],
  stateProjectRoot = meta.projectRoot
): Promise<void> {
  const findingsPath = reportPath(paths.runDir, "findings.json");
  const summaryPath = reportPath(paths.runDir, "summary.json");
  const reportJsonPath = reportPath(paths.runDir, "report.json");
  const promptManifestPath = reportPath(paths.runDir, "prompt-manifest.json");
  const structuredReportsPath = reportPath(paths.runDir, "structured-reports.json");
  const findingStateDir = await writeFindingState(stateProjectRoot, meta.options.outDir, findings, meta.runId, new Date(meta.completedAt ?? meta.startedAt), meta.options);
  const featureStateDir = await featureStateDirectory(stateProjectRoot, meta.options.outDir);
  const findingCounts = findingCountsBySeverity(findings);
  const suppressedFindingCounts = findingCountsBySeverity(suppressedFindings);
  const analytics = buildRunAnalytics(meta, promptManifest);
  meta.findingCounts = findingCounts;
  meta.suppressedFindingCounts = suppressedFindingCounts;
  meta.analytics = analytics;
  await writeJsonFile(findingsPath, findings);
  await writeJsonFile(promptManifestPath, promptManifest);
  await writeJsonFile(structuredReportsPath, structuredReports);
  const exportOutputs = await writeFindingExports(paths, findings, meta.options.exportFormats ?? [], {
    meta,
    evidence,
    structuredReports,
    suppressedFindings
  });
  await writeJsonFile(reportJsonPath, {
    schemaVersion: 1,
    tool: meta.tool,
    runId: meta.runId,
    reportDir: meta.reportDir,
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    durationMs: meta.durationMs,
    reportDurations: meta.reportDurations,
    options: meta.options,
    ai: meta.ai,
    source: meta.source,
    workspace: meta.workspace,
    snapshot: meta.snapshot,
    repositoryDrift: meta.repositoryDrift,
    cache: meta.cache,
    evidence,
    phases: meta.phases,
    findings,
    suppressedFindings,
    findingCounts,
    suppressedFindingCounts,
    structuredReports,
    promptManifest,
    analytics
  });
  await writeJsonFile(summaryPath, {
    tool: meta.tool,
    runId: meta.runId,
    reportDir: meta.reportDir,
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    durationMs: meta.durationMs,
    reportDurations: meta.reportDurations,
    ai: meta.ai,
    codex: meta.codex,
    source: meta.source,
    parallel: meta.parallel,
    snapshot: meta.snapshot,
    repositoryDrift: meta.repositoryDrift,
    since: promptManifest.since,
    evidence: {
      git: evidence.git,
      aiProvider: evidence.aiProvider,
      codex: evidence.codex,
      checks: {
        enabled: evidence.checks.enabled,
        commands: evidence.checks.commands,
        failed: hasFailedChecks(evidence)
      }
    },
    phases: meta.phases,
    findingCounts,
    suppressedFindingCounts,
    analytics,
    outputs: {
      reportJson: reportJsonPath,
      promptManifestJson: promptManifestPath,
      findingStateDir,
      featureStateDir,
      featuresJson: featuresPath,
      structuredReportsJson: structuredReportsPath,
      ...exportOutputs
    }
  });
  meta.outputs = {
    findingsJson: findingsPath,
    summaryJson: summaryPath,
    reportJson: reportJsonPath,
    promptManifestJson: promptManifestPath,
    findingStateDir,
    featureStateDir,
    featuresJson: featuresPath,
    structuredReportsJson: structuredReportsPath,
    ...exportOutputs
  };
}

function buildRunAnalytics(meta: AuditMeta, promptManifest: PromptManifest): RunAnalytics {
  const promptTokensByPhase = new Map(promptManifest.phases.map((phase) => [phase.phaseId, phase.approximateTokens]));
  const phases = meta.phases.map((phase) => {
    const telemetry = aggregatePhaseTelemetry(phase);
    const durationMs = phase.totalDurationMs ?? phase.durationMs ?? 0;
    return {
      id: phase.id,
      status: phase.status,
      durationMs,
      totalDurationMs: phase.totalDurationMs,
      promptTokens: promptTokensByPhase.get(phase.id) ?? 0,
      actualInputTokens: telemetry.inputTokens,
      actualOutputTokens: telemetry.outputTokens,
      actualTotalTokens: telemetry.totalTokens,
      actualCostUsd: telemetry.costUsd,
      telemetryKnown: telemetry.known,
      reportFile: phase.reportFile
    };
  });
  const estimatedInputTokens = phases.reduce((sum, phase) => sum + phase.promptTokens, 0);
  const actualInputTokens = sumOptional(phases.map((phase) => phase.actualInputTokens));
  const actualOutputTokens = sumOptional(phases.map((phase) => phase.actualOutputTokens));
  const actualTotalTokens = sumOptional(phases.map((phase) => phase.actualTotalTokens));
  const actualCostUsd = sumOptional(phases.map((phase) => phase.actualCostUsd));
  return {
    provider: meta.ai.provider,
    model: meta.ai.model,
    reasoning: meta.ai.reasoning,
    phaseCount: phases.length,
    totalDurationMs: phases.reduce((sum, phase) => sum + phase.durationMs, 0),
    estimatedInputTokens,
    estimatedTotalTokens: estimatedInputTokens,
    actualInputTokens,
    actualOutputTokens,
    actualTotalTokens,
    actualCostUsd,
    telemetryKnown: actualInputTokens !== undefined || actualOutputTokens !== undefined || actualTotalTokens !== undefined || actualCostUsd !== undefined,
    pricingKnown: actualCostUsd !== undefined,
    phases
  };
}

function aggregatePhaseTelemetry(phase: PhaseReportStatus): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  known: boolean;
} {
  const telemetry = [
    phase.providerRun?.telemetry,
    ...(phase.shards ?? []).map((shard) => shard.providerRun?.telemetry),
    ...(phase.deepReviewShards ?? []).map((shard) => shard.providerRun?.telemetry),
    ...(phase.repairAttempts ?? []).map((attempt) => attempt.providerRun?.telemetry)
  ].filter((item): item is ProviderUsageTelemetry => Boolean(item));
  return {
    inputTokens: sumOptional(telemetry.map((item) => item.inputTokens)),
    outputTokens: sumOptional(telemetry.map((item) => item.outputTokens)),
    totalTokens: sumOptional(telemetry.map((item) => item.totalTokens)),
    costUsd: sumOptional(telemetry.map((item) => item.costUsd)),
    known: telemetry.length > 0
  };
}

function sumOptional(values: Array<number | undefined>): number | undefined {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined;
}
