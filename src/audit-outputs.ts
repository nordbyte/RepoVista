import { hasFailedChecks } from "./evidence.js";
import { writeFindingExports } from "./exporters.js";
import { writeFindingState } from "./finding-state.js";
import { findingCountsBySeverity } from "./findings.js";
import { reportPath, writeJsonFile } from "./reports.js";
import type {
  AuditMeta,
  EvidencePack,
  PromptManifest,
  RunPaths,
  StructuredPhaseReport,
  StructuredFinding
} from "./types.js";

export async function writeStructuredOutputs(
  paths: RunPaths,
  meta: AuditMeta,
  findings: StructuredFinding[],
  evidence: EvidencePack,
  promptManifest: PromptManifest,
  featuresPath: string,
  structuredReports: StructuredPhaseReport[] = []
): Promise<void> {
  const findingsPath = reportPath(paths.runDir, "findings.json");
  const summaryPath = reportPath(paths.runDir, "summary.json");
  const promptManifestPath = reportPath(paths.runDir, "prompt-manifest.json");
  const structuredReportsPath = reportPath(paths.runDir, "structured-reports.json");
  const findingStateDir = await writeFindingState(meta.projectRoot, meta.options.outDir, findings, meta.runId);
  const findingCounts = findingCountsBySeverity(findings);
  meta.findingCounts = findingCounts;
  await writeJsonFile(findingsPath, findings);
  await writeJsonFile(promptManifestPath, promptManifest);
  await writeJsonFile(structuredReportsPath, structuredReports);
  const exportOutputs = await writeFindingExports(paths, findings, meta.options.exportFormats ?? []);
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
    outputs: {
      promptManifestJson: promptManifestPath,
      findingStateDir,
      featuresJson: featuresPath,
      structuredReportsJson: structuredReportsPath,
      ...exportOutputs
    }
  });
  meta.outputs = {
    findingsJson: findingsPath,
    summaryJson: summaryPath,
    promptManifestJson: promptManifestPath,
    findingStateDir,
    featuresJson: featuresPath,
    structuredReportsJson: structuredReportsPath,
    ...exportOutputs
  };
}
