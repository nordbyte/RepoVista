import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCodexExecArgs, runCodexPhase } from "../dist/index.js";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
}

test("codex args use read-only sandbox, target cwd and output-last-message", () => {
  const args = buildCodexExecArgs({
    phaseId: "architecture",
    phaseTitle: "Architecture",
    prompt: "prompt",
    projectRoot: "/repo",
    reportPath: "/repo/.repovista/run/report.md",
    sandbox: "read-only",
    jsonEvents: true,
    keepLogs: false,
    model: "gpt-5.5",
    profile: "default",
    reasoning: "high",
    fastMode: true
  });

  assert.deepEqual(args.slice(0, 2), ["exec", "--cd"]);
  assert.ok(args.includes("/repo"));
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("--config"));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--skip-git-repo-check"));
  assert.ok(args.includes("--output-last-message"));
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("--profile"));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('service_tier="priority"'));
});

test("codex runner writes success report via mocked process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-"));
  try {
    const reportPath = path.join(root, "report.md");
    const logsDir = path.join(root, "logs");
    const child = new FakeChild();
    const spawnAdapter = (_command, args, options) => {
      assert.equal(options.cwd, root);
      assert.ok(args.includes("--output-last-message"));
      setImmediate(async () => {
        await writeFile(reportPath, "# Report\n\nOK\n", "utf8");
        child.stdout.write("{\"event\":\"done\"}\n");
        child.stderr.write("technical\n");
        child.emit("close", 0);
      });
      return child;
    };

    const result = await runCodexPhase({
      phaseId: "architecture",
      phaseTitle: "Architecture",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      logsDir,
      sandbox: "read-only",
      jsonEvents: true,
      keepLogs: false
    }, spawnAdapter);

    assert.equal(result.success, true);
    assert.equal(await readFile(reportPath, "utf8"), "# Report\n\nOK\n");
    assert.equal(result.stdoutLogPath, path.join(logsDir, "architecture.stdout.jsonl"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex runner creates an error report on failed process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-fail-"));
  try {
    const reportPath = path.join(root, "report.md");
    const child = new FakeChild();
    const spawnAdapter = () => {
      setImmediate(() => {
        child.stderr.write("not authenticated\n");
        child.emit("close", 1);
      });
      return child;
    };

    const result = await runCodexPhase({
      phaseId: "risk",
      phaseTitle: "Risk",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: false
    }, spawnAdapter);

    assert.equal(result.success, false);
    assert.match(await readFile(reportPath, "utf8"), /Failed/);
    assert.match(result.error, /unauthenticated/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex runner cancels a phase after timeout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-timeout-"));
  try {
    const reportPath = path.join(root, "report.md");
    const child = new FakeChild();
    child.kill = (signal) => {
      setImmediate(() => child.emit("close", null, signal));
      return true;
    };
    const result = await runCodexPhase({
      phaseId: "architecture",
      phaseTitle: "Architecture",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: false,
      timeoutSeconds: 0.01
    }, () => child);

    assert.equal(result.success, false);
    assert.match(result.error, /timed out/);
    assert.match(await readFile(reportPath, "utf8"), /timed out/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
