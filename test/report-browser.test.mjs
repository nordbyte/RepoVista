import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReportBrowserState, deleteMarkedReportRuns, listReportRuns, renderReportsMenuFrame } from "../dist/index.js";

test("report browser lists report runs and renders sections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-report-browser-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const outRoot = path.join(root, ".repovista");
    await mkdir(outRoot, { recursive: true });
    await writeRun(path.join(outRoot, "2026-05-18T10-00-00-000Z"), {
      runId: "2026-05-18T10-00-00-000Z",
      startedAt: "2026-05-18T10:00:00.000Z",
      completedAt: "2026-05-18T10:00:00.000Z",
      title: "Older report"
    });
    await writeRun(path.join(outRoot, "2026-05-19T10-00-00-000Z"), {
      runId: "2026-05-19T10-00-00-000Z",
      completedAt: "2026-05-19T10:00:00.000Z",
      title: "Newer report",
      model: "Codex CLI configured default",
      reasoning: "xhigh",
      durationMs: 125000,
      inventoryDurationMs: 4000,
      summaryDurationMs: 5000,
      riskDurationMs: 45000
    });

    const runs = await listReportRuns(root, ".repovista", {
      defaultModelResolver: async () => "gpt-resolved-default"
    });

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
    }, { columns: 140, rows: 24, color: false });
    assert.match(listFrame, /RepoVista Reports/);
    assert.match(listFrame, /2026-05-19 10:00/);
    assert.match(listFrame, /model: gpt-resolved-default/);
    assert.match(listFrame, /model: gpt-5\.5/);
    assert.match(listFrame, /reasoning: xhigh/);
    assert.match(listFrame, /exit 0 \| total 2m 5s/);
    assert.match(listFrame, /\[ \] 2026-05-19 10:00/);
    assert.match(listFrame, /2026-05-19T10-00-00-000Z/);
    assert.doesNotMatch(listFrame, /model: default/);
    assert.doesNotMatch(listFrame, /Codex CLI Codex CLI configured default/);

    const markedFrame = renderReportsMenuFrame(runs, {
      screen: "runs",
      runCursor: 0,
      sectionCursor: 0,
      scroll: 0,
      markedRunDirs: new Set([runs[0].runDir])
    }, { columns: 100, rows: 24, color: false });
    assert.match(markedFrame, /\[x\] 2026-05-19 10:00/);
    assert.match(markedFrame, /1 marked/);

    const confirmFrame = renderReportsMenuFrame(runs, {
      screen: "confirm-delete",
      runCursor: 0,
      sectionCursor: 0,
      scroll: 0,
      markedRunDirs: new Set([runs[0].runDir])
    }, { columns: 100, rows: 24, color: false });
    assert.match(confirmFrame, /Confirm deletion of 1 report run/);
    assert.match(confirmFrame, /Enter deletes marked reports/);
    assert.match(confirmFrame, /2026-05-19T10-00-00-000Z/);

    const sectionFrame = renderReportsMenuFrame(runs, {
      screen: "sections",
      runCursor: 0,
      sectionCursor: 0,
      scroll: 0
    }, { columns: 100, rows: 24, color: false });
    assert.match(sectionFrame, /Full Report/);
    assert.match(sectionFrame, /Full Report: combined \| \d+ line\(s\) \| total 2m 5s/);
    assert.match(sectionFrame, /Summary: index\.md \| 4 line\(s\) \| generation 0m 5s/);
    assert.match(sectionFrame, /Evidence Pack: 00-inventory\.md \| 4 line\(s\) \| generation 0m 4s/);
    assert.match(sectionFrame, /Risk and Bug/);
    assert.match(sectionFrame, /Risk and Bug: 03-risk-and-bug-report\.md \| 4 line\(s\) \| generation 0m 45s \| phase total 1m 10s/);

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

test("report browser sorts report runs by creation time newest first", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-report-sort-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const outRoot = path.join(root, ".repovista");
    await mkdir(outRoot, { recursive: true });
    await writeRun(path.join(outRoot, "2026-05-18T10-00-00-000Z"), {
      runId: "2026-05-18T10-00-00-000Z",
      startedAt: "2026-05-18T10:00:00.000Z",
      completedAt: "2026-05-20T10:00:00.000Z",
      title: "Older creation but later completion"
    });
    await writeRun(path.join(outRoot, "2026-05-19T10-00-00-000Z"), {
      runId: "2026-05-19T10-00-00-000Z",
      startedAt: "2026-05-19T10:00:00.000Z",
      completedAt: "2026-05-19T10:30:00.000Z",
      title: "Newer creation"
    });

    const runs = await listReportRuns(root, ".repovista");

    assert.equal(runs.map((run) => run.runId).join(","), "2026-05-19T10-00-00-000Z,2026-05-18T10-00-00-000Z");
    const listFrame = renderReportsMenuFrame(runs, {
      screen: "runs",
      runCursor: 0,
      sectionCursor: 0,
      scroll: 0
    }, { columns: 100, rows: 24, color: false });
    assert.match(listFrame, /\[ \] 2026-05-19 10:00/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report browser can open on a selected completed audit run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-report-selected-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const outRoot = path.join(root, ".repovista");
    await mkdir(outRoot, { recursive: true });
    const newestRunDir = path.join(outRoot, "2026-05-20T10-00-00-000Z");
    const selectedRunDir = path.join(outRoot, "2026-05-19T10-00-00-000Z");
    await writeRun(newestRunDir, {
      runId: "2026-05-20T10-00-00-000Z",
      startedAt: "2026-05-20T10:00:00.000Z",
      completedAt: "2026-05-20T10:00:00.000Z",
      title: "Newest report"
    });
    await writeRun(selectedRunDir, {
      runId: "2026-05-19T10-00-00-000Z",
      startedAt: "2026-05-19T10:00:00.000Z",
      completedAt: "2026-05-19T10:00:00.000Z",
      title: "Just completed audit"
    });

    const runs = await listReportRuns(root, ".repovista");
    const state = createReportBrowserState(runs, {
      initialRunDir: selectedRunDir,
      initialScreen: "sections"
    });

    assert.equal(state.screen, "sections");
    assert.equal(runs[state.runCursor].runDir, selectedRunDir);

    const sectionFrame = renderReportsMenuFrame(runs, state, { columns: 100, rows: 24, color: false });
    assert.match(sectionFrame, /2026-05-19T10-00-00-000Z sections/);
    assert.match(sectionFrame, /Full Report/);
    assert.match(sectionFrame, /Risk and Bug/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report browser deletes marked report run directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-report-delete-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const outRoot = path.join(root, ".repovista");
    await mkdir(outRoot, { recursive: true });
    const deleteRunDir = path.join(outRoot, "2026-05-19T10-00-00-000Z");
    const keepRunDir = path.join(outRoot, "2026-05-18T10-00-00-000Z");
    await writeRun(deleteRunDir, {
      runId: "2026-05-19T10-00-00-000Z",
      completedAt: "2026-05-19T10:00:00.000Z",
      title: "Delete report"
    });
    await writeRun(keepRunDir, {
      runId: "2026-05-18T10-00-00-000Z",
      completedAt: "2026-05-18T10:00:00.000Z",
      title: "Keep report"
    });

    const runs = await listReportRuns(root, ".repovista");
    const deleted = await deleteMarkedReportRuns(runs, new Set([runs[0].runDir]));

    assert.equal(deleted, 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, "2026-05-18T10-00-00-000Z");
    await assert.rejects(stat(deleteRunDir), /ENOENT/);
    assert.equal((await stat(keepRunDir)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRun(runDir, input) {
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
    runId: input.runId,
    startedAt: input.startedAt ?? input.completedAt,
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
    durationMs: input.durationMs,
    reportDurations: {
      "00-inventory.md": input.inventoryDurationMs
    },
    phases: [
      {
        id: "summary",
        title: "Executive Summary",
        reportFile: "index.md",
        status: "success",
        durationMs: input.summaryDurationMs
      },
      {
        id: "risk-and-bug",
        title: "Risk, Bug, and Security Analysis",
        reportFile: "03-risk-and-bug-report.md",
        status: "success",
        durationMs: input.riskDurationMs,
        totalDurationMs: input.riskTotalDurationMs ?? 70000
      }
    ],
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
