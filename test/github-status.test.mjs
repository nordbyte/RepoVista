import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadStoredFindings, runGithubStatusCommand } from "../dist/index.js";

test("github-status refreshes linked issue and PR status for a GitHub source run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-github-status-"));
  try {
    const runDir = path.join(root, ".repovista", "run-1");
    await mkdir(runDir, { recursive: true });
    const finding = {
      id: "fnd_remote",
      source: "risk-and-bug",
      title: "Remote status finding",
      severity: "high",
      status: "open",
      paths: ["src/index.ts"],
      issue: {
        provider: "github",
        url: "https://github.com/owner/repo/issues/12",
        syncedAt: "2026-05-21T09:00:00.000Z"
      },
      pullRequest: {
        provider: "github",
        url: "https://github.com/owner/repo/pull/34",
        syncedAt: "2026-05-21T09:00:00.000Z"
      }
    };
    await writeFile(path.join(runDir, "findings.json"), JSON.stringify([finding], null, 2), "utf8");
    await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
      runId: "run-1",
      projectRoot: root,
      reportDir: runDir,
      startedAt: "2026-05-21T09:00:00.000Z",
      source: {
        type: "github",
        repository: "owner/repo",
        owner: "owner",
        repo: "repo",
        url: "https://github.com/owner/repo.git",
        commit: "abc123",
        cloneDir: root,
        fetchedAt: "2026-05-21T09:00:00.000Z"
      },
      phases: [],
      findings: [],
      exitCode: 0
    }), "utf8");

    const calls = [];
    const output = await runGithubStatusCommand({
      outDir: ".repovista",
      findingRunId: "run-1",
      findingId: "fnd_remote",
      json: false,
      exportFormats: []
    }, root, new Date("2026-05-21T10:00:00.000Z"), {
      execFile: async (command, args) => {
        calls.push({ command, args });
        if (args[0] === "issue" && args[1] === "view") {
          return {
            stdout: JSON.stringify({
              number: 12,
              title: "Remote status finding",
              url: "https://github.com/owner/repo/issues/12",
              state: "CLOSED",
              stateReason: "NOT_PLANNED",
              labels: [{ name: "bug" }],
              assignees: [{ login: "octocat" }],
              updatedAt: "2026-05-21T09:30:00Z",
              closedAt: "2026-05-21T09:35:00Z"
            })
          };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            stdout: JSON.stringify({
              number: 34,
              title: "Fix remote status finding",
              url: "https://github.com/owner/repo/pull/34",
              state: "CLOSED",
              isDraft: false,
              mergedAt: "2026-05-21T09:45:00Z",
              closedAt: "2026-05-21T09:45:00Z",
              mergeStateStatus: "CLEAN",
              headRefName: "repovista/fix",
              baseRefName: "main",
              updatedAt: "2026-05-21T09:45:00Z"
            })
          };
        }
        throw new Error(`unexpected call: ${command} ${args.join(" ")}`);
      }
    });

    assert.match(output, /issue closed\/not-planned/);
    assert.match(output, /PR merged/);
    assert.equal(calls.length, 2);

    const runFindings = JSON.parse(await readFile(path.join(runDir, "findings.json"), "utf8"));
    assert.equal(runFindings[0].issue.repository, "owner/repo");
    assert.equal(runFindings[0].issue.state, "closed");
    assert.equal(runFindings[0].issue.stateReason, "not-planned");
    assert.equal(runFindings[0].issue.lastStatusCheckAt, "2026-05-21T10:00:00.000Z");
    assert.deepEqual(runFindings[0].issue.labels, ["bug"]);
    assert.deepEqual(runFindings[0].issue.assignees, ["octocat"]);
    assert.equal(runFindings[0].pullRequest.state, "merged");
    assert.equal(runFindings[0].pullRequest.mergedAt, "2026-05-21T09:45:00Z");
    assert.equal(runFindings[0].history.at(-1).kind, "github-status-sync");

    const stored = await loadStoredFindings(root, ".repovista");
    assert.equal(stored[0].issue.stateReason, "not-planned");
    assert.equal(stored[0].pullRequest.state, "merged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("github-status records unknown status when gh cannot read a linked resource", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-github-status-error-"));
  try {
    await mkdir(path.join(root, ".repovista", "findings"), { recursive: true });
    const finding = {
      id: "fnd_error",
      source: "risk-and-bug",
      title: "Unavailable issue",
      severity: "medium",
      status: "open",
      paths: ["src/index.ts"],
      issue: {
        provider: "github",
        url: "https://github.com/owner/repo/issues/99",
        syncedAt: "2026-05-21T09:00:00.000Z"
      }
    };
    await writeFile(path.join(root, ".repovista", "findings", "f_Zm5kX2Vycm9y.json"), JSON.stringify({
      schemaVersion: 1,
      kind: "finding",
      data: finding
    }), "utf8");

    const output = await runGithubStatusCommand({
      outDir: ".repovista",
      findingId: "fnd_error",
      json: false,
      exportFormats: []
    }, root, new Date("2026-05-21T10:00:00.000Z"), {
      execFile: async () => {
        throw new Error("HTTP 404");
      }
    });

    assert.match(output, /issue unknown/);
    const stored = await loadStoredFindings(root, ".repovista");
    assert.equal(stored[0].issue.state, "unknown");
    assert.match(stored[0].issue.lastStatusError, /HTTP 404/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
