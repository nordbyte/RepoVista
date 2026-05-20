import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareGateViolations, compareHasRegression, runCompareCommand } from "../dist/index.js";

test("compare command renders finding and report deltas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-compare-"));
  try {
    const oldRun = path.join(root, ".repovista", "old");
    const newRun = path.join(root, ".repovista", "new");
    await mkdir(oldRun, { recursive: true });
    await mkdir(newRun, { recursive: true });
    await writeRun(oldRun, {
      runId: "old",
      findings: [
        {
          id: "finding-001",
          source: "03-risk-and-bug-report.md",
          title: "Old issue",
          severity: "high",
          paths: ["src/old.ts"],
          recommendation: "Fix old issue",
          evidenceReferences: [{ path: "src/old.ts", startLine: 1, endLine: 3, quote: "old" }],
          reproduction: "Inspect src/old.ts.",
          suggestedRegressionTest: "Add old regression test.",
          minimumFixScope: "src/old.ts"
        }
      ]
    });
    await writeRun(newRun, {
      runId: "new",
      findings: [
        {
          id: "finding-001",
          source: "03-risk-and-bug-report.md",
          title: "New issue",
          severity: "critical",
          paths: ["src/new.ts"],
          recommendation: "Fix new issue",
          evidenceReferences: [{ path: "src/new.ts", startLine: 1, endLine: 3, quote: "new" }],
          reproduction: "Inspect src/new.ts.",
          suggestedRegressionTest: "Add new regression test.",
          minimumFixScope: "src/new.ts"
        }
      ]
    });

    const output = await runCompareCommand(".repovista/old", ".repovista/new", root);

    assert.match(output, /RepoVista Report Comparison/);
    assert.match(output, /\| critical \| 0 \| 1 \| \+1 \|/);
    assert.match(output, /Added Findings/);
    assert.match(output, /CRITICAL: New issue/);
    assert.match(output, /Resolved Findings/);
    assert.match(output, /HIGH: Old issue/);
    assert.match(output, /Report Depth/);
    assert.match(output, /Proposal Changes/);
    assert.match(output, /Evidence Quality/);
    assert.match(output, /Resolved Old Findings/);

    const jsonOutput = await runCompareCommand(".repovista/old", ".repovista/new", root, { format: "json" });
    const parsed = JSON.parse(jsonOutput);
    assert.equal(parsed.regressions.length, 1);
    assert.equal(parsed.proposals.added.length, 1);
    assert.equal(parsed.evidenceQuality.old, 95);

    const htmlOutput = await runCompareCommand(".repovista/old", ".repovista/new", root, { format: "html" });
    assert.match(htmlOutput, /<!doctype html>/);
    assert.equal(await compareHasRegression(".repovista/old", ".repovista/new", root), true);
    assert.deepEqual(await compareGateViolations(".repovista/old", ".repovista/new", root, { maxNewCritical: 0 }), [
      "new critical findings 1 exceeds configured maximum 0."
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRun(runDir, { runId, findings }) {
  await writeFile(path.join(runDir, "findings.json"), JSON.stringify(findings, null, 2), "utf8");
  await writeFile(path.join(runDir, "structured-reports.json"), JSON.stringify([
    {
      schemaVersion: 1,
      phaseId: "feature-roadmap",
      source: "04-feature-roadmap.md",
      executiveSummary: "Roadmap",
      keyPoints: ["point"],
      evidenceReferences: [`src/${runId}.ts`],
      recommendations: ["recommendation"],
      proposals: [
        {
          title: `${runId} proposal`,
          description: "Improve the run-specific path.",
          evidence: [`src/${runId}.ts`],
          benefit: "Better quality",
          effort: "small",
          risk: "low",
          affected: [`src/${runId}.ts`],
          steps: ["Implement"],
          priority: "P1",
          confidence: "high"
        }
      ],
      warnings: []
    }
  ], null, 2), "utf8");
  await writeFile(path.join(runDir, "summary.json"), JSON.stringify({
    runId,
    ai: {
      displayName: "Codex CLI",
      model: "gpt-5.5",
      reasoning: "xhigh"
    },
    evidence: {
      checks: {
        enabled: true,
        commands: ["npm test"],
        failed: false
      }
    },
    phases: [
      {
        id: "risk-and-bug",
        status: "success",
        qualityPassed: true
      }
    ],
    findingCounts: countFindings(findings)
  }), "utf8");
  await writeFile(path.join(runDir, "03-risk-and-bug-report.md"), `# Risk

## Executive Summary

Report for ${runId} references src/${runId}.ts.
`, "utf8");
}

function countFindings(findings) {
  return findings.reduce((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    return counts;
  }, {});
}
