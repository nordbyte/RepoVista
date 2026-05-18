import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasCriticalFindings, runAudit } from "../dist/index.js";

test("audit creates the full report structure with mocked Codex phases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const options = {
      command: "audit",
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: true,
      includes: [],
      ignores: [],
      ci: true,
      failOnCritical: true,
      progress: false,
      keepLogs: false
    };

    const result = await runAudit(options, {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async () => true,
      runCodex: async (request) => {
        const content = request.phaseId === "risk-and-bug"
          ? "# Risk\n\n## Critical Findings\n\nNo critical findings.\n"
          : `# ${request.phaseTitle}\n\nReport for ${request.phaseId}.\n`;
        await writeFile(request.reportPath, content, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 5,
          exitCode: 0
        };
      }
    });

    assert.equal(result.exitCode, 0);
    const expectedFiles = [
      "00-inventory.md",
      "01-architecture-report.md",
      "02-code-quality-report.md",
      "03-risk-and-bug-report.md",
      "04-feature-roadmap.md",
      "index.md",
      "meta.json"
    ];

    for (const fileName of expectedFiles) {
      assert.ok(await readFile(path.join(result.paths.runDir, fileName), "utf8"));
    }

    const meta = JSON.parse(await readFile(path.join(result.paths.runDir, "meta.json"), "utf8"));
    assert.equal(meta.codex.sandbox, "read-only");
    assert.equal(meta.codex.model, "Codex configured default");
    assert.equal(meta.codex.reasoning, "model default");
    assert.equal(meta.phases.every((phase) => phase.status === "success"), true);

    const inventory = await readFile(path.join(result.paths.runDir, "00-inventory.md"), "utf8");
    assert.match(inventory, /## Codex Execution Settings/);
    assert.match(inventory, /Model: Codex configured default/);
    assert.match(inventory, /Reasoning: model default/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit rejects project root as report folder before creating run directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-out-root-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const options = {
      command: "audit",
      outDir: ".",
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

    await assert.rejects(
      () => runAudit(options, {
        cwd: root,
        now: new Date("2026-05-18T14:57:32.123Z"),
        version: "0.1.0",
        commandExists: async () => true
      }),
      /report directory must not be identical/i
    );

    assert.deepEqual((await readdir(root)).sort(), ["package.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("critical finding detector distinguishes empty critical sections from real findings", () => {
  assert.equal(hasCriticalFindings("## Critical Findings\n\nNo critical findings."), false);
  assert.equal(
    hasCriticalFindings("## Critical Findings\n\n- Title: Unsafe auth\n- Severity: Critical"),
    true
  );
});

test("resume preserves completed phase reports without rerunning Codex", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-resume-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const options = {
      command: "audit",
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: [],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    };
    const dependencies = {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async () => true,
      runCommand: async (command, args) => ({
        command: [command, ...args].join(" "),
        exitCode: command === "git" && args[0] === "rev-parse" ? 1 : 0,
        durationMs: 1,
        timedOut: false,
        stdout: command === "codex" ? "codex-cli 0.130.0\n" : "ok\n"
      })
    };

    let runCount = 0;
    const first = await runAudit(options, {
      ...dependencies,
      runCodex: async (request) => {
        runCount += 1;
        await writeFile(request.reportPath, `# ${request.phaseTitle}\n\nReport for ${request.phaseId} references src/index.ts.\n`, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });
    assert.equal(runCount, 5);

    const resumed = await runAudit({ ...options, resumeDir: first.paths.runDir }, {
      ...dependencies,
      runCodex: async () => {
        throw new Error("Codex should not run for completed resume");
      }
    });

    assert.equal(resumed.exitCode, 0);
    assert.equal(resumed.meta.phases.every((phase) => phase.status === "success"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
