import test from "node:test";
import assert from "node:assert/strict";
import { renderFindingsMenuFrame } from "../dist/index.js";

test("findings-ui renders publish readiness, queue targets, filters, and run selection", () => {
  const findings = [
    {
      id: "fnd_menu",
      source: "risk-and-bug",
      title: "Menu finding",
      severity: "high",
      status: "open",
      labels: ["bug"],
      paths: ["src/index.ts"],
      evidence: "src/index.ts:1 shows the issue.",
      evidenceDetails: [{ path: "src/index.ts", startLine: 1, endLine: 1, quote: "issue" }],
      issue: { provider: "github", url: "https://github.com/nordbyte/RepoVista/issues/1", state: "open", syncedAt: "2026-05-21T10:00:00.000Z" },
      pullRequest: { provider: "github", url: "https://github.com/nordbyte/RepoVista/pull/2", state: "merged", syncedAt: "2026-05-21T10:00:00.000Z" }
    },
    {
      id: "fnd_no_issue",
      source: "risk-and-bug",
      title: "Needs issue",
      severity: "medium",
      status: "open",
      paths: ["src/other.ts"]
    }
  ];
  const publishRuns = {
    fnd_menu: [
      {
        runId: "2026-05-21T10-00-00-000Z",
        runDir: "/tmp/run-a",
        repository: "nordbyte/RepoVista",
        sourceLabel: "nordbyte/RepoVista@main"
      },
      {
        runId: "2026-05-20T10-00-00-000Z",
        runDir: "/tmp/run-b",
        repository: "nordbyte/RepoVista",
        sourceLabel: "nordbyte/RepoVista@v0.4.0"
      }
    ]
  };

  const listFrame = renderFindingsMenuFrame(findings, {
    cursor: 0,
    detail: false,
    board: false,
    screen: "list",
    scroll: 0,
    severityFilter: "all",
    statusFilter: "all",
    workflowFilter: "all",
    publishRuns,
    publishTargets: { fnd_menu: "pr" },
    selectedRunDirs: { fnd_menu: "/tmp/run-a" }
  }, { columns: 140, rows: 40, color: false });

  assert.match(listFrame, /\[P\] HIGH/);
  assert.match(listFrame, /github ok \| issue open \| PR merged \| evidence ok/);
  assert.match(listFrame, /Space queue \| i issue \| p PR/);
  assert.match(listFrame, /workflow all/);

  const confirmFrame = renderFindingsMenuFrame(findings, {
    cursor: 0,
    detail: false,
    board: false,
    screen: "confirm-publish",
    scroll: 0,
    severityFilter: "all",
    statusFilter: "all",
    workflowFilter: "all",
    publishRuns,
    publishTargets: { fnd_menu: "pr", fnd_no_issue: "issue" },
    selectedRunDirs: { fnd_menu: "/tmp/run-a" },
    issueLabels: ["repovista"],
    issueAssignees: ["octocat"]
  }, { columns: 140, rows: 40, color: false });

  assert.match(confirmFrame, /Publish 2 queued finding\(s\)/);
  assert.match(confirmFrame, /PR \| HIGH \| fnd_menu \| nordbyte\/RepoVista/);
  assert.match(confirmFrame, /ISSUE \| MEDIUM \| fnd_no_issue \| no github source/);
  assert.match(confirmFrame, /labels bug, repovista \| assignees octocat/);

  const selectFrame = renderFindingsMenuFrame(findings, {
    cursor: 0,
    detail: false,
    board: false,
    screen: "select-run",
    scroll: 0,
    severityFilter: "all",
    statusFilter: "all",
    workflowFilter: "all",
    publishRuns,
    publishTargets: { fnd_menu: "issue" },
    selectedRunDirs: {},
    runChoiceFindingId: "fnd_menu",
    runChoiceCursor: 0
  }, { columns: 140, rows: 40, color: false });

  assert.match(selectFrame, /Select GitHub source run for fnd_menu/);
  assert.match(selectFrame, /nordbyte\/RepoVista \| 2026-05-21T10-00-00-000Z/);

  const detailFrame = renderFindingsMenuFrame(findings, {
    cursor: 0,
    detail: true,
    board: false,
    screen: "detail",
    scroll: 0,
    severityFilter: "all",
    statusFilter: "all",
    workflowFilter: "all",
    publishRuns,
    publishTargets: { fnd_menu: "pr" },
    selectedRunDirs: { fnd_menu: "/tmp/run-a" }
  }, { columns: 140, rows: 80, color: false });

  assert.match(detailFrame, /Publish readiness: github ok/);
  assert.match(detailFrame, /Publish source: nordbyte\/RepoVista@main/);
  assert.match(detailFrame, /Queued target: pr/);
  assert.match(detailFrame, /## GitHub/);
  assert.match(detailFrame, /Issue: open/);
  assert.match(detailFrame, /Pull request: merged/);
});
