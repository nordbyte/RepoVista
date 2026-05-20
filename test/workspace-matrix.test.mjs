import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OPTIONS, runWorkspaceMatrix } from "../dist/index.js";

test("workspace matrix creates one report per workspace plus aggregate summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-matrix-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "matrix-root",
      workspaces: ["packages/*"]
    }), "utf8");
    await mkdir(path.join(root, "packages", "api", "src"), { recursive: true });
    await mkdir(path.join(root, "packages", "web", "src"), { recursive: true });
    await writeFile(path.join(root, "packages", "api", "package.json"), JSON.stringify({ name: "@fixture/api" }), "utf8");
    await writeFile(path.join(root, "packages", "web", "package.json"), JSON.stringify({ name: "@fixture/web" }), "utf8");
    await writeFile(path.join(root, "packages", "api", "src", "index.ts"), "export const api = true;\n", "utf8");
    await writeFile(path.join(root, "packages", "web", "src", "index.ts"), "export const web = true;\n", "utf8");

    const result = await runWorkspaceMatrix({
      ...DEFAULT_OPTIONS,
      workspaceMatrix: true,
      allWorkspaces: true,
      parallel: "off",
      runChecks: false,
      strictReports: false,
      repairReports: false,
      exportFormats: [],
      progress: false
    }, {
      cwd: root,
      version: "0.0.0-test",
      now: new Date("2026-05-20T10:00:00.000Z"),
      runCommand: async (command, args) => {
        const rendered = [command, ...args].join(" ");
        if (rendered === "npm --version") return ok(rendered, "10.0.0\n");
        if (rendered === "codex --version") return ok(rendered, "codex-cli 0.130.0\n");
        if (rendered === "git rev-parse --is-inside-work-tree") return { ...ok(rendered), exitCode: 1 };
        return ok(rendered);
      },
      runProvider: async (request) => {
        await writeFile(request.reportPath, `# ${request.phaseTitle}\n\n## Executive Summary\n\nWorkspace report.\n\n## Recommended Next Steps\n\nNone.\n`, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.equal(result.workspaceCount, 2);
    assert.equal(result.exitCode, 0);
    assert.equal(result.results.length, 2);
    const aggregate = await readFile(path.join(result.runDir, "index.md"), "utf8");
    assert.match(aggregate, /@fixture\/api/);
    assert.match(aggregate, /@fixture\/web/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function ok(command, stdout = "") {
  return {
    command,
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    stdout
  };
}
