import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPreflight } from "../dist/index.js";

const baseOptions = {
  command: "audit",
  outDir: ".repovista",
  sandbox: "read-only",
  language: "English",
  json: false,
  includes: [],
  ignores: [],
  ci: false,
  failOnCritical: false,
  progress: false,
  keepLogs: false
};

test("preflight fails clearly when codex is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-preflight-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const runDir = path.join(root, ".repovista", "run");
    await mkdir(runDir, { recursive: true });

    await assert.rejects(
      () => runPreflight(root, runDir, baseOptions, { commandExists: async () => false }),
      /Codex CLI was not found/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight accepts a recognizable project and warns for non-git directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-preflight-ok-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const runDir = path.join(root, ".repovista", "run");
    await mkdir(runDir, { recursive: true });

    const result = await runPreflight(root, runDir, baseOptions, { commandExists: async () => true });

    assert.equal(result.codexAvailable, true);
    assert.equal(result.projectRecognized, true);
    assert.equal(result.gitRepository, false);
    assert.equal(result.warnings.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight checks the selected provider command", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-preflight-claude-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const runDir = path.join(root, ".repovista", "run");
    await mkdir(runDir, { recursive: true });
    const seen = [];

    const result = await runPreflight(root, runDir, { ...baseOptions, provider: "claude" }, {
      commandExists: async (command, args) => {
        seen.push([command, args]);
        return true;
      }
    });

    assert.deepEqual(seen, [["claude", ["--version"]]]);
    assert.equal(result.provider.id, "claude");
    assert.equal(result.providerAvailable, true);
    assert.equal(result.codexAvailable, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
