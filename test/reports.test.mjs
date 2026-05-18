import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareRunDirectory, writeMeta } from "../dist/index.js";

test("report run directory is created with a stable run id and logs folder when requested", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-reports-"));
  try {
    const paths = await prepareRunDirectory(root, ".repovista", "2026-05-18T14-57-32-123Z", true);

    assert.equal(paths.runId, "2026-05-18T14-57-32-123Z");
    assert.equal(paths.runDir, path.join(root, ".repovista", "2026-05-18T14-57-32-123Z"));
    assert.equal(paths.logsDir, path.join(paths.runDir, "logs"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("metadata is written as formatted JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-meta-"));
  try {
    const metaPath = await writeMeta(root, {
      tool: { name: "RepoVista", version: "0.1.0" },
      projectRoot: root,
      reportDir: root,
      runId: "run",
      startedAt: "2026-05-18T14:57:32.123Z",
      options: {
        outDir: ".repovista",
        language: "English",
        json: true,
        includes: [],
        ignores: [],
        ci: true,
        failOnCritical: true,
        progress: false,
        keepLogs: true
      },
      codex: { sandbox: "read-only" },
      preflight: {
        codexAvailable: true,
        projectRecognized: true,
        gitRepository: true,
        warnings: []
      },
      phases: [],
      exitCode: 0
    });

    const json = JSON.parse(await readFile(metaPath, "utf8"));
    assert.equal(json.tool.name, "RepoVista");
    assert.equal(json.codex.sandbox, "read-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
