import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  loadStoredFindings,
  runListFindingsCommand,
  runNextFindingCommand,
  runCreateIssueCommand,
  runFixFindingCommand,
  runOpenPrCommand,
  runRollbackPatchCommand,
  runRevalidateFindingCommand,
  runShowFindingCommand,
  runTriageFindingCommand,
  writeFindingState
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function initTestGitRepo(root) {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  await execFileAsync("git", ["config", "core.eol", "lf"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "RepoVista Test"], { cwd: root });
}

test("finding lifecycle commands read, triage and revalidate persistent state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-finding-state-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const finding = {
      id: "fnd_fixture",
      source: "03-risk-and-bug-report.md",
      title: "Fixture finding",
      severity: "high",
      category: "reliability",
      status: "open",
      triage: "needs-fix",
      signature: "sig_fixture",
      paths: ["src/index.ts"],
      evidence: "src/index.ts exports value",
      evidenceReferences: ["src/index.ts"],
      recommendation: "Add validation.",
      confidence: "high"
    };

    const stateDir = await writeFindingState(root, ".repovista", [finding], "run-1", new Date("2026-05-18T10:00:00.000Z"));
    assert.match(stateDir, /\.repovista[/\\]findings$/);

    const next = await runNextFindingCommand({ outDir: ".repovista", findingStatus: "open" }, root);
    assert.match(next, /fnd_fixture/);
    assert.match(next, /Fixture finding/);

    const shown = await runShowFindingCommand({ outDir: ".repovista", findingId: "fnd_fixture" }, root);
    assert.match(shown, /History/);

    const fixPreview = await runFixFindingCommand({ outDir: ".repovista", findingId: "fnd_fixture", dryRun: true }, { projectRoot: root });
    assert.match(fixPreview, /RepoVista fix dry run/);
    assert.match(fixPreview, /Fixture finding/);

    const triaged = await runTriageFindingCommand({
      outDir: ".repovista",
      findingId: "fnd_fixture",
      findingStatus: "false-positive",
      note: "not applicable in fixture"
    }, root, new Date("2026-05-18T11:00:00.000Z"));
    assert.match(triaged, /false-positive/);
    assert.equal((await loadStoredFindings(root, ".repovista"))[0].status, "false-positive");

    await runRevalidateFindingCommand({
      outDir: ".repovista",
      findingId: "fnd_fixture"
    }, root, new Date("2026-05-18T12:00:00.000Z"));
    const revalidated = (await loadStoredFindings(root, ".repovista"))[0];
    assert.equal(revalidated.status, "open");
    assert.equal(revalidated.evidenceValidation.passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finding lifecycle rules add owners labels sla and issue dry-run metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-finding-rules-"));
  try {
    const finding = {
      id: "fnd_rules",
      source: "03-risk-and-bug-report.md",
      title: "API route lacks timeout",
      severity: "medium",
      status: "open",
      paths: ["packages/api/src/route.ts"]
    };
    await writeFindingState(root, ".repovista", [finding], "run-1", new Date("2026-05-01T10:00:00.000Z"), {
      ownerRules: ["packages/api/**=team-api"],
      labelRules: ["packages/api/**=area-api"],
      slaDays: 7
    });
    const stored = (await loadStoredFindings(root, ".repovista"))[0];
    assert.equal(stored.owner, "team-api");
    assert.deepEqual(stored.labels, ["area-api"]);
    assert.equal(stored.sla.days, 7);
    assert.equal(stored.sla.overdue, false);

    const dryRun = await runCreateIssueCommand({
      outDir: ".repovista",
      findingId: "fnd_rules",
      dryRun: true,
      issueLabels: ["repovista"],
      issueAssignees: ["octocat"],
      issueSync: true,
      issueReopen: true
    }, root);
    assert.match(dryRun, /GitHub issue dry run/);
    assert.match(dryRun, /area-api, repovista/);
    assert.match(dryRun, /Reopen linked: yes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findings command can list one run without persistent state noise", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-finding-run-"));
  try {
    const persistent = {
      id: "fnd_old",
      source: "03-risk-and-bug-report.md",
      title: "Old persistent finding",
      severity: "medium",
      paths: ["src/old.ts"]
    };
    await writeFindingState(root, ".repovista", [persistent], "old-run", new Date("2026-05-18T10:00:00.000Z"));

    const runDir = path.join(root, ".repovista", "run-1");
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "findings.json"), JSON.stringify([
      {
        id: "fnd_current",
        source: "03-risk-and-bug-report.md",
        title: "Current run finding",
        severity: "high",
        status: "open",
        paths: ["src/current.ts"]
      }
    ], null, 2), "utf8");

    const output = await runListFindingsCommand({
      outDir: ".repovista",
      findingRunId: "run-1",
      json: true,
      exportFormats: []
    }, root);
    const listed = JSON.parse(output);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "fnd_current");
    assert.doesNotMatch(output, /fnd_old/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finding state deduplicates old and new finding signatures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-finding-dedupe-"));
  try {
    const oldFinding = {
      id: "fnd_old_signature",
      source: "03-risk-and-bug-report.md",
      title: "Shared route misses validation",
      severity: "medium",
      category: "Reliability",
      status: "fixed",
      signature: "legacy|route",
      paths: ["src/route.ts"]
    };
    await writeFindingState(root, ".repovista", [oldFinding], "run-1", new Date("2026-05-18T10:00:00.000Z"));

    const newFinding = {
      id: "fnd_new_signature",
      source: "03-risk-and-bug-report.md",
      title: "Shared route misses validation",
      severity: "high",
      category: "Reliability",
      status: "open",
      signature: "new|route|src/route.ts:1",
      paths: ["src/route.ts"],
      evidenceReferences: [{ path: "src/route.ts", startLine: 1, endLine: 3 }]
    };
    await writeFindingState(root, ".repovista", [newFinding], "run-2", new Date("2026-05-18T11:00:00.000Z"));

    const findings = await loadStoredFindings(root, ".repovista");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, "fnd_old_signature");
    assert.equal(findings[0].status, "open");
    assert.equal(findings[0].lastSeenRunId, "run-2");
    assert.equal(findings[0].signature, "new|route|src/route.ts:1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finding state uses collision-resistant filenames and rejects corrupt files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-finding-store-"));
  try {
    const first = {
      id: "fnd/a",
      source: "03-risk-and-bug-report.md",
      title: "First",
      severity: "medium",
      paths: ["src/a.ts"]
    };
    const second = {
      id: "fnd_a",
      source: "03-risk-and-bug-report.md",
      title: "Second",
      severity: "medium",
      paths: ["src/b.ts"]
    };
    const stateDir = await writeFindingState(root, ".repovista", [first, second], "run-1", new Date("2026-05-18T10:00:00.000Z"));
    const files = (await readdir(stateDir)).filter((file) => file.endsWith(".json"));
    assert.equal(files.length, 2);
    assert.equal((await loadStoredFindings(root, ".repovista")).length, 2);

    await writeFile(path.join(stateDir, "bad.json"), "{not-json", "utf8");
    await assert.rejects(
      () => loadStoredFindings(root, ".repovista"),
      /finding state file/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finding state migrates legacy per-file wrappers through the state layer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-finding-legacy-"));
  try {
    const stateDir = path.join(root, ".repovista", "findings");
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, "legacy.json"), JSON.stringify({
      version: 1,
      finding: {
        id: "fnd_legacy",
        source: "03-risk-and-bug-report.md",
        title: "Legacy finding",
        severity: "low",
        paths: ["src/legacy.ts"]
      }
    }), "utf8");

    const findings = await loadStoredFindings(root, ".repovista");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, "fnd_legacy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fix workflow records pre/post diff and fails changes outside finding scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-fix-scope-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "other.ts"), "export const other = 1;\n", "utf8");
    await initTestGitRepo(root);
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });

    const finding = {
      id: "fnd_scope",
      source: "03-risk-and-bug-report.md",
      title: "Scoped finding",
      severity: "high",
      status: "open",
      paths: ["src/index.ts"],
      minimumFixScope: "src/index.ts"
    };
    await writeFindingState(root, ".repovista", [finding], "run-1", new Date("2026-05-18T10:00:00.000Z"));

    const output = await runFixFindingCommand({
      outDir: ".repovista",
      findingId: "fnd_scope",
      patchMaxFiles: 1,
      force: true
    }, {
      projectRoot: root,
      runProvider: async (request) => {
        await writeFile(path.join(root, "src", "other.ts"), "export const other = 2;\n", "utf8");
        await writeFile(request.reportPath, "# Fix\n", "utf8");
        return {
          phaseId: request.phaseId,
          reportPath: request.reportPath,
          durationMs: 1,
          success: true,
          exitCode: 0
        };
      }
    });

    assert.match(output, /Scope gate: failed/);
    const patches = (await readdir(path.join(root, ".repovista", "patches"))).filter((file) => file.endsWith(".json"));
    assert.equal(patches.length, 1);
    assert.match(output, /Patch diff:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("patch rollback reverses a recorded patch diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-rollback-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await initTestGitRepo(root);
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });

    await writeFindingState(root, ".repovista", [{
      id: "fnd_rollback",
      source: "03-risk-and-bug-report.md",
      title: "Rollback finding",
      severity: "high",
      status: "open",
      paths: ["src/index.ts"]
    }], "run-1", new Date("2026-05-18T10:00:00.000Z"));

    const output = await runFixFindingCommand({
      outDir: ".repovista",
      findingId: "fnd_rollback",
      checkCommands: ["node -e \"process.exit(0)\""],
      runChecks: true,
      force: true
    }, {
      projectRoot: root,
      runProvider: async (request) => {
        await writeFile(path.join(root, "src", "index.ts"), "export const value = 2;\n", "utf8");
        await writeFile(request.reportPath, "# Fix\n", "utf8");
        return {
          phaseId: request.phaseId,
          reportPath: request.reportPath,
          durationMs: 1,
          success: true,
          exitCode: 0
        };
      }
    });
    const patchId = /RepoVista patch attempt (pat_[^:]+):/.exec(output)?.[1];
    assert.ok(patchId);
    await runRollbackPatchCommand({ outDir: ".repovista", patchId }, root, new Date("2026-05-18T11:00:00.000Z"));
    const content = await readFile(path.join(root, "src", "index.ts"), "utf8");
    assert.equal(content, "export const value = 1;\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("open-pr default title summarizes the patch instead of using finding ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-open-pr-title-"));
  try {
    const patchDir = path.join(root, ".repovista", "patches");
    await mkdir(patchDir, { recursive: true });
    await writeFile(path.join(patchDir, "pat_title.json"), `${JSON.stringify({
      schemaVersion: 1,
      patchAttemptId: "pat_title",
      findingIds: ["fnd_260bc40fe1ef"],
      featureIds: [],
      status: "applied",
      plan: "Finding: fnd_260bc40fe1ef - Watchdog menubar indicator imports a nonexistent function and swallows the error\nSeverity: medium",
      filesChanged: ["collectors/watchdog.py"],
      preDiff: "",
      postDiff: "",
      commandsRun: [],
      provider: { id: "codex" },
      git: {},
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z"
    }, null, 2)}\n`, "utf8");

    const output = await runOpenPrCommand({
      outDir: ".repovista",
      patchId: "pat_title",
      dryRun: true
    }, root);

    assert.match(output, /- title: fix: watchdog menubar indicator imports a nonexistent function and swallows the error/);
    assert.doesNotMatch(output, /RepoVista: fix fnd_260bc40fe1ef/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
