import { hasFailedChecks } from "./evidence.js";
import { writeFindingExports } from "./exporters.js";
import { featureStateDirectory } from "./feature-state.js";
import { writeFindingState } from "./finding-state.js";
import { findingCountsBySeverity } from "./findings.js";
import { reportPath, writeJsonFile } from "./reports.js";
import type {
  AuditMeta,
  EvidencePack,
  PromptManifest,
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
  suppressedFindings: StructuredFinding[] = []
): Promise<void> {
  const findingsPath = reportPath(paths.runDir, "findings.json");
  const summaryPath = reportPath(paths.runDir, "summary.json");
  const reportJsonPath = reportPath(paths.runDir, "report.json");
  const promptManifestPath = reportPath(paths.runDir, "prompt-manifest.json");
  const structuredReportsPath = reportPath(paths.runDir, "structured-reports.json");
  const findingStateDir = await writeFindingState(meta.projectRoot, meta.options.outDir, findings, meta.runId);
  const featureStateDir = await featureStateDirectory(meta.projectRoot, meta.options.outDir);
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
    options: meta.options,
    ai: meta.ai,
    workspace: meta.workspace,
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
    ai: meta.ai,
    codex: meta.codex,
    parallel: meta.parallel,
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
  const phases = meta.phases.map((phase) => ({
    id: phase.id,
    status: phase.status,
    durationMs: phase.durationMs ?? 0,
    promptTokens: promptTokensByPhase.get(phase.id) ?? 0,
    reportFile: phase.reportFile
  }));
  const estimatedInputTokens = phases.reduce((sum, phase) => sum + phase.promptTokens, 0);
  return {
    provider: meta.ai.provider,
    model: meta.ai.model,
    reasoning: meta.ai.reasoning,
    phaseCount: phases.length,
    totalDurationMs: phases.reduce((sum, phase) => sum + phase.durationMs, 0),
    estimatedInputTokens,
    estimatedTotalTokens: estimatedInputTokens,
    pricingKnown: false,
    phases
  };
}
