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
    await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
      runId: "run",
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
    await writeFile(path.join(runDir, "findings.json"), JSON.stringify([
      {
        id: "fnd_1",
        source: "03-risk-and-bug-report.md",
        title: "High fixture",
        severity: "high",
        paths: ["src/audit.ts"],
        evidenceReferences: ["src/audit.ts"]
      }
    ]), "utf8");
    await writeFile(path.join(runDir, "structured-reports.json"), "[]", "utf8");
    for (const file of ["01-architecture-report.md", "02-code-quality-report.md", "03-risk-and-bug-report.md", "04-feature-roadmap.md", "index.md"]) {
      await writeFile(path.join(runDir, file), "# Fixture\n\nsrc/audit.ts\n", "utf8");
    }

    const reviewed = await reviewRunDirectory(root, ".repovista/run");
    assert.equal(reviewed.weakEvidence.length, 1);
    assert.match(renderPrComment(reviewed), /High fixture/);

    const markdown = await runReviewCommand({ outDir: ".repovista", reportRunDir: ".repovista/run", json: false }, root);
    assert.match(markdown, /RepoVista Run Review/);

    const dryRun = await runPrCommentCommand({ outDir: ".repovista", reportRunDir: ".repovista/run", dryRun: true }, root);
    assert.match(dryRun, /RepoVista PR comment dry run/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
