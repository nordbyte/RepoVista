import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderPrComment, reviewRunDirectory, runPrCommentCommand, runReviewCommand } from "../dist/index.js";

test("review command reports weak evidence and PR comment body", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-review-"));
  try {
    const runDir = path.join(root, ".repovista", "run");
    await mkdir(runDir, { recursive: true });
    const findings = [
      {
        id: "fnd_1",
        source: "03-risk-and-bug-report.md",
        title: "High fixture",
        severity: "high",
        paths: ["src/audit.ts"],
        evidenceReferences: ["src/audit.ts"]
      }
    ];
    const structuredReports = ["architecture", "code-quality", "risk-and-bug", "feature-roadmap", "summary"].map((phaseId) => ({
      schemaVersion: 1,
      phaseId,
      source: `${phaseId}.md`,
      keyPoints: ["src/audit.ts"],
      evidenceReferences: phaseId === "summary" ? [] : ["src/audit.ts"],
      recommendations: phaseId === "summary" ? [] : ["Review src/audit.ts"],
      warnings: []
    }));
    await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
      runId: "run",
      options: {
        exportFormats: ["sarif", "html", "jsonl"]
      },
      ai: {
        displayName: "Codex CLI",
        model: "gpt-5.5",
        reasoning: "xhigh"
      },
      evidence: {
        checks: {
          enabled: true,
          commands: ["npm test"]
        },
        git: {}
      },
      findingCounts: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0
      }
    }), "utf8");
    await writeFile(path.join(runDir, "findings.json"), JSON.stringify(findings), "utf8");
    await writeFile(path.join(runDir, "structured-reports.json"), JSON.stringify(structuredReports), "utf8");
    await writeFile(path.join(runDir, "summary.json"), JSON.stringify({ runId: "run", findings }), "utf8");
    await writeFile(path.join(runDir, "report.json"), JSON.stringify({ runId: "run", findings }), "utf8");
    await writeFile(path.join(runDir, "prompt-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      runId: "run",
      phases: structuredReports.map((report) => ({ phaseId: report.phaseId, reportFile: report.source, includedFiles: [], omittedFiles: [] }))
    }), "utf8");
    await writeFile(path.join(runDir, "findings.sarif"), JSON.stringify({ version: "2.1.0", runs: [] }), "utf8");
    await writeFile(path.join(runDir, "report.html"), "<!doctype html><html><body>RepoVista</body></html>", "utf8");
    await writeFile(path.join(runDir, "findings.jsonl"), `${JSON.stringify(findings[0])}\n`, "utf8");
    for (const file of ["01-architecture-report.md", "02-code-quality-report.md", "03-risk-and-bug-report.md", "04-feature-roadmap.md", "index.md"]) {
      await writeFile(path.join(runDir, file), "# Fixture\n\nsrc/audit.ts\n", "utf8");
    }

    const reviewed = await reviewRunDirectory(root, ".repovista/run");
    assert.equal(reviewed.weakEvidence.length, 1);
    assert.equal(reviewed.artifactHealth.filter((artifact) => artifact.warnings.length).length, 0);
    assert.match(renderPrComment(reviewed), /High fixture/);

    const markdown = await runReviewCommand({ outDir: ".repovista", reportRunDir: ".repovista/run", json: false }, root);
    assert.match(markdown, /RepoVista Run Review/);
    assert.match(markdown, /Artifact Health/);

    const dryRun = await runPrCommentCommand({ outDir: ".repovista", reportRunDir: ".repovista/run", dryRun: true }, root);
    assert.match(dryRun, /RepoVista PR comment dry run/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
