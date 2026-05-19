import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listReportRuns, renderReportsMenuFrame } from "../dist/index.js";

test("report browser lists report runs and renders sections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-report-browser-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const outRoot = path.join(root, ".repovista");
    await mkdir(outRoot, { recursive: true });
    await writeRun(path.join(outRoot, "2026-05-18T10-00-00-000Z"), {
      runId: "2026-05-18T10-00-00-000Z",
      completedAt: "2026-05-18T10:00:00.000Z",
      title: "Older report"
    });
    await writeRun(path.join(outRoot, "2026-05-19T10-00-00-000Z"), {
      runId: "2026-05-19T10-00-00-000Z",
      completedAt: "2026-05-19T10:00:00.000Z",
      title: "Newer report",
      model: "Codex CLI configured default",
      reasoning: "xhigh"
    });

    const runs = await listReportRuns(root, ".repovista");

    assert.equal(runs.length, 2);
    assert.equal(runs[0].runId, "2026-05-19T10-00-00-000Z");
    assert.equal(runs[0].findingCount, 1);
    assert.ok(runs[0].sections.some((section) => section.id === "full"));
    assert.ok(runs[0].sections.some((section) => section.fileName === "03-risk-and-bug-report.md"));

    const listFrame = renderReportsMenuFrame(runs, {
      screen: "runs",
      runCursor: 0,
      sectionCursor: 0,
      scroll: 0
    }, { columns: 100, rows: 24, color: false });
    assert.match(listFrame, /RepoVista Reports/);
    assert.match(listFrame, /2026-05-19 10:00/);
    assert.match(listFrame, /model: default/);
    assert.match(listFrame, /model: gpt-5\.5/);
    assert.match(listFrame, /reasoning: xhigh/);
    assert.match(listFrame, /2026-05-19T10-00-00-000Z/);
    assert.doesNotMatch(listFrame, /Codex CLI Codex CLI configured default/);

    const sectionFrame = renderReportsMenuFrame(runs, {
      screen: "sections",
      runCursor: 0,
      sectionCursor: 0,
      scroll: 0
    }, { columns: 100, rows: 24, color: false });
    assert.match(sectionFrame, /Full Report/);
    assert.match(sectionFrame, /Risk and Bug/);

    const viewerFrame = renderReportsMenuFrame(runs, {
      screen: "viewer",
      runCursor: 0,
      sectionCursor: 0,
      scroll: 0
    }, { columns: 100, rows: 24, color: false });
    assert.match(viewerFrame, /# Summary/);
    assert.match(viewerFrame, /Newer report/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRun(runDir, input) {
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
    runId: input.runId,
    startedAt: input.completedAt,
    completedAt: input.completedAt,
    ai: {
      provider: "codex",
      displayName: "Codex CLI",
      model: input.model ?? "gpt-5.5",
      reasoning: input.reasoning ?? "high"
    },
    findingCounts: {
      high: 1
    },
    exitCode: 0
  }, null, 2), "utf8");
  await writeFile(path.join(runDir, "findings.json"), JSON.stringify([
    {
      id: "fnd_test",
      title: "Fixture finding",
      severity: "high",
      category: "bug",
      status: "open",
      paths: ["src/audit.ts"]
    }
  ], null, 2), "utf8");
  await writeFile(path.join(runDir, "index.md"), `# ${input.title}\n\nSummary text.\n`, "utf8");
  await writeFile(path.join(runDir, "00-inventory.md"), "# Inventory\n\nEvidence text.\n", "utf8");
  await writeFile(path.join(runDir, "03-risk-and-bug-report.md"), "# Risk\n\nRisk text.\n", "utf8");
}
