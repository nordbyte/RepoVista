import { appendFile } from "node:fs/promises";
import { maskSensitiveText } from "./secrets.js";
import type { AuditMeta } from "./types.js";

export async function appendGithubStepSummary(meta: AuditMeta): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  const body = renderGithubStepSummary(meta);
  await appendFile(summaryPath, body, "utf8").catch(() => undefined);
}

export function renderGithubStepSummary(meta: AuditMeta): string {
  const counts = meta.findingCounts ?? {};
  const phases = meta.phases.map((phase) => `| ${phase.title} | ${phase.status} | ${phase.qualityScore ?? "n/a"} |`).join("\n");
  const outputs = meta.outputs
    ? Object.entries(meta.outputs)
        .filter(([, value]) => value)
        .map(([key, value]) => `- ${key}: \`${maskSensitiveText(String(value))}\``)
        .join("\n")
    : "- n/a";
  return `## RepoVista

Run: \`${meta.runId}\`
Provider: ${meta.ai.displayName}
Model: ${meta.ai.model}
Reasoning: ${meta.ai.reasoning}
Review mode: ${meta.options.reviewMode ?? "default"}

| Severity | Findings |
|---|---:|
| Critical | ${counts.critical ?? 0} |
| High | ${counts.high ?? 0} |
| Medium | ${counts.medium ?? 0} |
| Low | ${counts.low ?? 0} |

| Phase | Status | Quality |
|---|---|---:|
${phases || "| n/a | n/a | n/a |"}

Outputs:
${outputs}

`;
}
