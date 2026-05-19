import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OPTIONS, hasCriticalFindings, initializeProjectMap, projectScanFingerprint, runAudit } from "../dist/index.js";

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
      "report.json",
      "meta.json"
    ];

    for (const fileName of expectedFiles) {
      assert.ok(await readFile(path.join(result.paths.runDir, fileName), "utf8"));
    }

    const meta = JSON.parse(await readFile(path.join(result.paths.runDir, "meta.json"), "utf8"));
    assert.equal(meta.codex.sandbox, "read-only");
    assert.equal(meta.codex.model, "Codex configured default");
    assert.equal(meta.codex.reasoning, "model default");
    assert.equal(meta.ai.provider, "codex");
    assert.equal(meta.ai.model, "Codex CLI configured default");
    assert.equal(meta.phases.every((phase) => phase.status === "success"), true);
    assert.equal(typeof meta.cache.scanFingerprint, "string");
    assert.equal(meta.workspace.detected, false);

    const inventory = await readFile(path.join(result.paths.runDir, "00-inventory.md"), "utf8");
    assert.match(inventory, /## AI Provider Execution Settings/);
    assert.match(inventory, /Provider: Codex CLI/);
    assert.match(inventory, /Model: Codex configured default/);
    assert.match(inventory, /Reasoning: model default/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit passes the selected provider through phases and metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-provider-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const seenCommands = [];
    const seenProviders = [];

    const result = await runAudit({
      command: "audit",
      provider: "claude",
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: ["summary"],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false,
      model: "sonnet",
      reasoning: "high"
    }, {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async (command) => {
        seenCommands.push(command);
        return true;
      },
      runCommand: async (command, args) => ({
        command: [command, ...args].join(" "),
        exitCode: command === "git" && args[0] === "rev-parse" ? 1 : 0,
        durationMs: 1,
        timedOut: false,
        stdout: command === "claude" ? "2.1.140 (Claude Code)\n" : "ok\n"
      }),
      runProvider: async (request) => {
        seenProviders.push(request.provider);
        await writeFile(request.reportPath, `# ${request.phaseTitle}\n\nReport for ${request.provider}.\n`, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.deepEqual(seenCommands, ["claude"]);
    assert.deepEqual(seenProviders, ["claude"]);
    assert.equal(result.meta.ai.provider, "claude");
    assert.equal(result.meta.ai.model, "sonnet");
    assert.equal(result.meta.ai.reasoning, "high");
    assert.equal(result.meta.evidence.aiProvider.version, "2.1.140 (Claude Code)");

    const inventory = await readFile(path.join(result.paths.runDir, "00-inventory.md"), "utf8");
    assert.match(inventory, /Provider: Claude Code CLI/);
    assert.match(inventory, /Model: sonnet/);
    assert.match(inventory, /Reasoning: high/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit can split shardable phases across parallel provider sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-parallel-"));
  try {
    await mkdir(path.join(root, "src", "alpha"), { recursive: true });
    await mkdir(path.join(root, "src", "beta"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "alpha", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "beta", "b.ts"), "export const b = 1;\n", "utf8");
    await initializeProjectMap(root, DEFAULT_OPTIONS, new Date("2026-05-18T14:57:32.123Z"));

    let active = 0;
    let maxActive = 0;
    const seen = [];
    const result = await runAudit({
      command: "audit",
      provider: "codex",
      parallel: 2,
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: ["architecture"],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    }, {
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
      }),
      runProvider: async (request) => {
        seen.push(request.phaseId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, request.phaseId.includes("thread") ? 20 : 1));
        active -= 1;
        await writeFile(request.reportPath, `# ${request.phaseTitle}\n\nReport for ${request.phaseId} references src/alpha/a.ts and src/beta/b.ts.\n`, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.equal(result.exitCode, 0);
    assert.ok(maxActive >= 2);
    assert.ok(seen.some((phaseId) => phaseId === "architecture-thread-1"));
    assert.ok(seen.some((phaseId) => phaseId === "architecture-thread-2"));
    assert.ok(seen.some((phaseId) => phaseId === "architecture-synthesis"));
    assert.equal(result.meta.parallel.effectiveParallelism, 2);
    assert.equal(result.meta.phases.find((phase) => phase.id === "architecture").shards.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parallel resume reuses completed shard reports before synthesis", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-parallel-resume-"));
  try {
    await mkdir(path.join(root, "src", "alpha"), { recursive: true });
    await mkdir(path.join(root, "src", "beta"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "alpha", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "beta", "b.ts"), "export const b = 1;\n", "utf8");
    await initializeProjectMap(root, DEFAULT_OPTIONS, new Date("2026-05-18T14:57:32.123Z"));
    const resumeDir = path.join(root, ".repovista", "manual-run");
    await mkdir(path.join(resumeDir, "shards", "architecture"), { recursive: true });
    await writeFile(path.join(resumeDir, "00-inventory.md"), "# Inventory\n\nExisting run.\n", "utf8");
    await writeFile(path.join(resumeDir, "shards", "architecture", "thread-1.md"), "# Thread 1\n\nExisting shard.\n", "utf8");
    await writeFile(path.join(resumeDir, "shards", "architecture", "thread-2.md"), "# Thread 2\n\nExisting shard.\n", "utf8");
    await writeFile(path.join(resumeDir, "meta.json"), JSON.stringify({
      phases: [
        {
          id: "architecture",
          title: "Architecture Analysis",
          reportFile: "01-architecture-report.md",
          status: "pending",
          shards: [
            {
              id: "thread-1",
              title: "Thread 1",
              reportFile: "shards/architecture/thread-1.md",
              status: "success"
            },
            {
              id: "thread-2",
              title: "Thread 2",
              reportFile: "shards/architecture/thread-2.md",
              status: "success"
            }
          ]
        }
      ]
    }), "utf8");

    const seen = [];
    const result = await runAudit({
      command: "audit",
      provider: "codex",
      parallel: 2,
      outDir: ".repovista",
      resumeDir,
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: ["architecture"],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    }, {
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
      }),
      runProvider: async (request) => {
        seen.push(request.phaseId);
        assert.equal(request.phaseId, "architecture-synthesis");
        await writeFile(request.reportPath, "# Architecture Analysis Synthesis\n\nExisting shards were synthesized from src/alpha/a.ts and src/beta/b.ts.\n", "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(seen, ["architecture-synthesis"]);
    assert.equal(result.meta.phases.find((phase) => phase.id === "architecture").shards.every((shard) => shard.durationMs === 0), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deep review runs feature-sliced risk shards and merges schema findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-deep-"));
  try {
    await mkdir(path.join(root, "src", "alpha"), { recursive: true });
    await mkdir(path.join(root, "src", "beta"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "alpha", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "beta", "b.ts"), "export const b = 1;\n", "utf8");
    await initializeProjectMap(root, DEFAULT_OPTIONS, new Date("2026-05-18T14:57:32.123Z"));

    const seen = [];
    const result = await runAudit({
      command: "audit",
      provider: "codex",
      parallel: 2,
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: ["risk-and-bug"],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false,
      deepReview: true
    }, {
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
      }),
      runProvider: async (request) => {
        seen.push(request.phaseId);
        const content = request.phaseId.includes("-deep-")
          ? riskReportWithFinding("Shard-specific missing guard", "src/alpha/a.ts", "export const a = 1;")
          : completeMockReport("risk-and-bug", request.phaseTitle);
        await writeFile(request.reportPath, content, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.equal(result.exitCode, 0);
    assert.ok(seen.some((phaseId) => phaseId.startsWith("risk-and-bug-deep-")));
    assert.ok(result.meta.phases.find((phase) => phase.id === "risk-and-bug").deepReviewShards.length > 0);
    const findings = JSON.parse(await readFile(path.join(result.paths.runDir, "findings.json"), "utf8"));
    const shardFinding = findings.find((finding) => finding.title === "Shard-specific missing guard");
    assert.ok(shardFinding);
    assert.ok(shardFinding.featureId);
    assert.equal(shardFinding.evidenceValidation.references[0].source, "prompt-context");
    assert.ok(await readFile(path.join(result.paths.runDir, "deep-review", "risk-and-bug", result.meta.phases.find((phase) => phase.id === "risk-and-bug").deepReviewShards[0].id + ".md"), "utf8"));
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

test("audit rejects unsafe report and resume paths before writing reports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-paths-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "reports", "run"), { recursive: true });
    await mkdir(path.join(root, ".repovista", "not-a-run"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "reports", "run", "00-inventory.md"), "# Inventory\n", "utf8");
    const options = {
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
    const dependencies = {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async () => true
    };

    await assert.rejects(
      () => runAudit({ ...options, outDir: "../repovista-reports" }, dependencies),
      /inside the project root/i
    );
    await assert.rejects(
      () => runAudit({ ...options, outDir: "src/reports" }, dependencies),
      /protected project path/i
    );
    await assert.rejects(
      () => runAudit({ ...options, resumeDir: path.join(root, "reports", "run") }, dependencies),
      /inside the report directory/i
    );
    await assert.rejects(
      () => runAudit({ ...options, resumeDir: path.join(root, ".repovista", "not-a-run") }, dependencies),
      /does not look like a RepoVista run directory/i
    );
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

test("scan fingerprint includes mtime fallback and audit context", () => {
  const files = [
    {
      relativePath: "src/index.ts",
      size: 42,
      mtimeMs: 1000
    }
  ];

  assert.notEqual(projectScanFingerprint(files), projectScanFingerprint([{ ...files[0], mtimeMs: 2000 }]));
  assert.notEqual(projectScanFingerprint(files, { runChecks: false }), projectScanFingerprint(files, { runChecks: true }));
});

test("risk phase auto-repairs missing findings schema before extraction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-repair-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const seen = [];

    const result = await runAudit({
      command: "audit",
      provider: "codex",
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: ["risk-and-bug"],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    }, {
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
      }),
      runProvider: async (request) => {
        seen.push(request.phaseId);
        const content = request.phaseId.includes("repair")
          ? riskReportWithFinding("Repair-added finding", "src/index.ts", "export const value = 1;")
          : "# Risk\n\n## Critical Findings\n\nNo critical findings.\n";
        await writeFile(request.reportPath, content, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.deepEqual(seen, ["risk-and-bug", "risk-and-bug-repair-1"]);
    assert.ok(result.meta.findings.some((finding) => finding.title === "Repair-added finding"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
        await writeFile(request.reportPath, completeMockReport(request.phaseId, request.phaseTitle), "utf8");
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

test("resume reruns failed or unusable reports even when files exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-resume-failed-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const resumeDir = path.join(root, ".repovista", "failed-run");
    await mkdir(resumeDir, { recursive: true });
    await writeFile(path.join(resumeDir, "00-inventory.md"), "# Inventory\n", "utf8");
    await writeFile(path.join(resumeDir, "01-architecture-report.md"), "# Architecture Analysis\n\n## Status\n\nFailed.\n", "utf8");
    await writeFile(path.join(resumeDir, "meta.json"), JSON.stringify({
      phases: [
        {
          id: "architecture",
          title: "Architecture Analysis",
          reportFile: "01-architecture-report.md",
          status: "failed"
        }
      ]
    }), "utf8");

    let runCount = 0;
    const result = await runAudit({
      command: "audit",
      provider: "codex",
      outDir: ".repovista",
      resumeDir,
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: ["architecture"],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    }, {
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
      }),
      runCodex: async (request) => {
        runCount += 1;
        await writeFile(request.reportPath, completeMockReport(request.phaseId, request.phaseTitle), "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.equal(runCount, 1);
    assert.equal(result.meta.phases.find((phase) => phase.id === "architecture").status, "success");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function completeMockReport(phaseId, phaseTitle) {
  if (phaseId === "summary") {
    return `# ${phaseTitle}

## Short Conclusion

The fixture is stable.

## What the Project Does

It demonstrates RepoVista tests.

## Top Strengths

- Small scope.

## Top Weaknesses

- Limited fixture depth.

## Recommended Order of Next Steps

- Keep tests current.
`;
  }

  if (phaseId === "risk-and-bug") {
    return `# ${phaseTitle}

## Executive Summary

No concrete risk was found across src/index.ts, package.json and test/index.test.ts.

## Critical Findings

No critical findings.

## High Findings

No high findings.

## Medium Findings

No medium findings.

## Low Findings

No low findings.

## Recommended Next Steps

- Keep validation around src/index.ts, package.json and tsconfig.json.

\`\`\`json
{
  "schemaVersion": 1,
  "findings": []
}
\`\`\`
`;
  }

  if (phaseId === "feature-roadmap") {
    return `# ${phaseTitle}

## Executive Summary

Roadmap references src/index.ts, package.json, README.md, test/index.test.ts and tsconfig.json.

## Useful Improvements to Existing Features

| Title | Description | Evidence | Benefit | Effort | Risk | Affected | Steps | Priority | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| Improve CLI validation | Validate more inputs | src/index.ts | Better errors | small | low | src/index.ts | Add tests | P1 | high |
| Improve package scripts | Expand scripts | package.json | Better DX | small | low | package.json | Add script | P2 | high |
| Improve docs | Add examples | README.md | Better onboarding | small | low | README.md | Add docs | P2 | high |

## Useful New Features

| Title | Description | Evidence | Benefit | Effort | Risk | Affected | Steps | Priority | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| Add fixtures | More fixtures | test/index.test.ts | Better coverage | medium | low | test/index.test.ts | Add fixture | P2 | medium |
| Add config hints | Document config | tsconfig.json | Better setup | small | low | tsconfig.json | Add hint | P3 | medium |
| Add source map | Map source | src/index.ts | Better analysis | medium | medium | src/index.ts | Implement map | P3 | medium |

## Prioritized Roadmap

- P1: Improve CLI validation.
`;
  }

  if (phaseId === "code-quality") {
    return `# ${phaseTitle}

## Executive Summary

The fixture references src/index.ts, package.json, README.md, test/index.test.ts and tsconfig.json.

## Biggest Strengths

- Clear source in src/index.ts.

## Biggest Weaknesses

- Small fixture in test/index.test.ts.

## Test Coverage and Test Strategy

Coverage is represented by test/index.test.ts.

## Prioritized Recommendations

- Keep package.json scripts current.
`;
  }

  return `# ${phaseTitle}

## Executive Summary

Architecture references src/index.ts, package.json, README.md, test/index.test.ts and tsconfig.json.

## Project Purpose

Test RepoVista behavior.

## Tech Stack

Node.js and TypeScript via package.json and tsconfig.json.

## Module and Component Overview

The source module is src/index.ts and tests live in test/index.test.ts.

## Data Flow and Control Flow

The fixture has a simple flow from src/index.ts to test/index.test.ts.

## Recommendations

- Keep README.md aligned with package.json.
`;
}

function riskReportWithFinding(title, filePath, quote) {
  return `# Risk and Bug Analysis

## Executive Summary

One shard risk was found in ${filePath}, src/beta/b.ts and package.json.

## Critical Findings

No critical findings.

## High Findings

One high finding.

## Medium Findings

No medium findings.

## Low Findings

No low findings.

## Recommended Next Steps

- Add a guard around ${filePath}.

<!-- repovista-findings:start -->
${JSON.stringify({
    schemaVersion: 1,
    findings: [
      {
        title,
        severity: "high",
        category: "Reliability",
        status: "open",
        signature: `deep|${filePath}|guard`,
        affectedPaths: [filePath],
        evidence: `${filePath} exposes a value without a guard.`,
        evidenceReferences: [
          {
            path: filePath,
            startLine: 1,
            endLine: 1,
            quote
          }
        ],
        problemRationale: "The shard exposes behavior without a defensive guard.",
        recommendedFix: "Add a focused guard and keep the exported behavior covered.",
        reproduction: `Inspect ${filePath} and observe the unguarded export.`,
        suggestedRegressionTest: "Add a test that fails when the guard is absent.",
        minimumFixScope: `Update ${filePath} and the closest test fixture.`,
        estimatedEffort: "small",
        confidence: "high"
      }
    ]
  }, null, 2)}
<!-- repovista-findings:end -->
`;
}
