import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OPTIONS, hasCriticalFindings, initializeProjectMap, projectScanFingerprint, runAudit, runProcess } from "../dist/index.js";

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

    const auditSettings = [];
    const result = await runAudit(options, {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async () => true,
      resolveProviderDefaultModel: async () => "gpt-test-default",
      loggerSink: {
        auditSettings: (summary) => auditSettings.push(summary)
      },
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
      "status.json",
      "meta.json"
    ];

    for (const fileName of expectedFiles) {
      assert.ok(await readFile(path.join(result.paths.runDir, fileName), "utf8"));
    }

    const meta = JSON.parse(await readFile(path.join(result.paths.runDir, "meta.json"), "utf8"));
    assert.equal(meta.codex.sandbox, "read-only");
    assert.equal(meta.codex.model, "gpt-test-default");
    assert.equal(meta.codex.reasoning, "xhigh");
    assert.equal(meta.ai.provider, "codex");
    assert.equal(meta.ai.model, "gpt-test-default");
    assert.equal(meta.phases.every((phase) => phase.status === "success"), true);
    assert.equal(typeof meta.cache.scanFingerprint, "string");
    assert.equal(meta.workspace.detected, false);

    const status = JSON.parse(await readFile(path.join(result.paths.runDir, "status.json"), "utf8"));
    assert.equal(status.schemaVersion, 1);
    assert.equal(status.status, "success");
    assert.equal(status.runId, result.paths.runId);
    assert.equal(status.runDir, result.paths.runDir);
    assert.equal(status.phases.every((phase) => phase.status === "success"), true);
    assert.equal(status.options.reasoning, "xhigh");

    const inventory = await readFile(path.join(result.paths.runDir, "00-inventory.md"), "utf8");
    assert.match(inventory, /## AI Provider Execution Settings/);
    assert.match(inventory, /Provider: Codex CLI/);
    assert.match(inventory, /Model: gpt-test-default/);
    assert.match(inventory, /Reasoning: xhigh/);

    assert.equal(auditSettings.length, 1);
    const settingsText = [auditSettings[0].title, ...auditSettings[0].lines].join("\n");
    assert.match(settingsText, /Provider: Codex CLI \(codex\).*executable: codex/);
    assert.match(settingsText, /Model: gpt-test-default.*reasoning: xhigh.*fast mode: off.*sandbox: read-only/);
    assert.match(settingsText, /Report: mode: full audit.*audit profile: full audit.*review: general risk and quality.*phases: all phases/);
    assert.match(settingsText, /Quality: checks: off.*strict gates: off.*repair: off/);
    assert.doesNotMatch(settingsText, /configured default|model default/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bug findings mode runs only the risk report needed for findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-bug-findings-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const seen = [];
    const result = await runAudit({
      ...DEFAULT_OPTIONS,
      outDir: ".repovista",
      bugFindingsOnly: true,
      deepReview: true,
      runChecks: false,
      strictReports: false,
      repairReports: false,
      progress: false,
      exportFormats: []
    }, {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async () => true,
      runCodex: async (request) => {
        seen.push(request.phaseId);
        assert.match(request.prompt, /Bug-findings mode/);
        assert.doesNotMatch(request.prompt, /Previous findings/);
        await writeFile(
          request.reportPath,
          riskReportWithFinding("Bug-only finding", "src/index.ts", "export const value = 1;"),
          "utf8"
        );
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 5,
          exitCode: 0
        };
      }
    });

    assert.deepEqual(seen, ["risk-and-bug"]);
    assert.equal(result.meta.options.bugFindingsOnly, true);
    assert.deepEqual(result.meta.options.phases, ["risk-and-bug"]);
    assert.equal(result.meta.options.deepReview, false);
    assert.equal(result.meta.phases.find((phase) => phase.id === "risk-and-bug").status, "success");
    assert.equal(result.meta.phases.find((phase) => phase.id === "architecture").status, "skipped");
    assert.equal(result.meta.findings.length, 1);
    assert.ok(await readFile(path.join(result.paths.runDir, "03-risk-and-bug-report.md"), "utf8"));
    await assert.rejects(readFile(path.join(result.paths.runDir, "01-architecture-report.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(path.join(result.paths.runDir, "02-code-quality-report.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(path.join(result.paths.runDir, "04-feature-roadmap.md"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(path.join(result.paths.runDir, "index.md"), "utf8"), /ENOENT/);
    const structuredReports = JSON.parse(await readFile(path.join(result.paths.runDir, "structured-reports.json"), "utf8"));
    assert.deepEqual(structuredReports.map((report) => report.phaseId), ["risk-and-bug"]);
    const promptManifest = JSON.parse(await readFile(path.join(result.paths.runDir, "prompt-manifest.json"), "utf8"));
    assert.deepEqual(promptManifest.phases.map((phase) => phase.phaseId), ["risk-and-bug"]);
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

test("audit auto-initializes the project map for default parallel mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-auto-map-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const result = await runAudit({
      ...DEFAULT_OPTIONS,
      phases: ["summary"],
      runChecks: false,
      strictReports: false,
      repairReports: false,
      progress: false
    }, {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.3.0",
      commandExists: async () => true,
      runCommand: async (command, args) => ({
        command: [command, ...args].join(" "),
        exitCode: command === "git" && args[0] === "rev-parse" ? 1 : 0,
        durationMs: 1,
        timedOut: false,
        stdout: command === "codex" ? "codex 0.1.0\n" : "ok\n"
      }),
      runProvider: async (request) => {
        await writeFile(request.reportPath, "# Summary\n\nNo issues found.\n", "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 5,
          exitCode: 0
        };
      }
    });

    assert.equal(result.meta.options.parallel, "auto");
    assert.equal(result.meta.ai.reasoning, "xhigh");
    assert.ok(result.meta.parallel);
    assert.ok(await readFile(path.join(root, ".repovista", "project-map.json"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit can analyze a public GitHub repository into the local report root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-github-"));
  const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  try {
    const providerRoots = [];
    const cloneCalls = [];
    const result = await runAudit({
      ...DEFAULT_OPTIONS,
      githubRepo: "nordbyte/example",
      phases: ["summary"],
      strictReports: false,
      repairReports: false,
      progress: false
    }, {
      cwd: root,
      now: new Date("2026-05-21T10:15:00.000Z"),
      version: "0.4.0",
      commandExists: async () => true,
      resolveProviderDefaultModel: async () => "gpt-test-default",
      runCommand: async (command, args, options) => {
        if (command === "npm" && args[0] === "--version") {
          return commandOk(command, args, "10.0.0\n");
        }
        if (command === "codex") {
          return commandOk(command, args, "codex 0.1.0\n");
        }
        if (command !== "git") {
          return commandOk(command, args, "");
        }
        if (args[0] === "ls-remote" && args.includes("--symref")) {
          return commandOk(command, args, `ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`);
        }
        if (args[0] === "clone") {
          const cloneDir = args.at(-1);
          cloneCalls.push({ args, cwd: options.cwd, cloneDir });
          await mkdir(path.join(cloneDir, "src"), { recursive: true });
          await mkdir(path.join(cloneDir, ".git"), { recursive: true });
          await writeFile(path.join(cloneDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
          await writeFile(path.join(cloneDir, "README.md"), "# Remote Example\n", "utf8");
          await writeFile(path.join(cloneDir, "package.json"), JSON.stringify({ name: "remote-example" }), "utf8");
          await writeFile(path.join(cloneDir, "src", "index.ts"), "export const remote = true;\n", "utf8");
          return commandOk(command, args, "");
        }
        if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
          return commandOk(command, args, "true\n");
        }
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return commandOk(command, args, `${sha}\n`);
        }
        if (args[0] === "branch" && args[1] === "--show-current") {
          return commandOk(command, args, "main\n");
        }
        if (args[0] === "status") {
          return commandOk(command, args, "");
        }
        if (args[0] === "remote") {
          return commandOk(command, args, "https://github.com/nordbyte/example.git\n");
        }
        return commandOk(command, args, "");
      },
      runProvider: async (request) => {
        providerRoots.push(request.projectRoot);
        await writeFile(request.reportPath, "# Summary\n\nRemote repository summary.\n", "utf8");
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
    assert.equal(result.paths.outRoot, path.join(root, ".repovista"));
    assert.equal(result.meta.source.repository, "nordbyte/example");
    assert.equal(result.meta.source.defaultBranch, "main");
    assert.equal(result.meta.source.commit, sha);
    assert.equal(result.meta.projectRoot, path.join(root, ".repovista", "sources", "github", "nordbyte", "example", sha.slice(0, 12)));
    assert.equal(result.meta.options.runChecks, false);
    assert.equal(result.meta.evidence.projectRoot, result.meta.projectRoot);
    assert.equal(providerRoots.every((item) => item === result.meta.projectRoot), true);
    assert.equal(cloneCalls.length, 1);
    assert.ok(await readFile(path.join(result.paths.runDir, "meta.json"), "utf8"));

    await assert.rejects(
      readFile(path.join(root, ".repovista", "project-map.json"), "utf8"),
      /ENOENT/
    );
    const projectMap = JSON.parse(await readFile(path.join(result.paths.runDir, "project-map.json"), "utf8"));
    assert.equal(projectMap.projectRoot, result.meta.projectRoot);
    assert.equal(result.meta.parallel.projectMapPath, path.join(result.paths.runDir, "project-map.json"));
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

test("audit records repository drift when the target checkout changes during a run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-drift-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await git(root, ["config", "user.name", "RepoVista Test"]);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "initial"]);

    const warnings = [];
    let mutated = false;
    const result = await runAudit({
      command: "audit",
      provider: "codex",
      parallel: "off",
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
      repairReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    }, {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async () => true,
      loggerSink: {
        warn: (message) => warnings.push(message)
      },
      runCommand: async (command, args, options) => {
        if (command === "git") {
          const result = await runProcess(command, args, {
            cwd: options.cwd,
            shell: options.shell,
            timeoutMs: options.timeoutSeconds * 1000,
            stdoutLimit: 1024 * 1024,
            stderrLimit: 1024 * 1024
          });
          return {
            command: result.renderedCommand,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
            stdout: result.stdout.trim() || undefined,
            stderr: result.stderr.trim() || undefined,
            error: result.error
          };
        }
        return {
          command: [command, ...args].join(" "),
          exitCode: 0,
          durationMs: 1,
          timedOut: false,
          stdout: command === "codex" ? "codex-cli 0.130.0\n" : "10.0.0\n"
        };
      },
      runProvider: async (request) => {
        if (!mutated) {
          mutated = true;
          await writeFile(path.join(root, "src", "index.ts"), "export const value = 2;\n", "utf8");
          await git(root, ["add", "src/index.ts"]);
          await git(root, ["commit", "-m", "change during audit"]);
        }
        await writeFile(request.reportPath, completeMockReport(request.phaseId, request.phaseTitle), "utf8");
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
    assert.equal(result.meta.repositoryDrift.detected, true);
    assert.match(result.meta.repositoryDrift.warnings.join("\n"), /Repository changed during audit/);
    assert.match(result.meta.repositoryDrift.warnings.join("\n"), /commit/);
    assert.ok(warnings.some((warning) => /Repository changed during audit/.test(warning)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit runs code quality and risk in parallel after architecture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-phase-dag-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const events = [];
    const activeDetailPhases = new Set();
    let overlapped = false;
    let riskPrompt = "";
    const result = await runAudit({
      command: "audit",
      provider: "codex",
      parallel: "auto",
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: ["architecture", "code-quality", "risk-and-bug"],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      repairReports: false,
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
        events.push(`${request.phaseId}:start`);
        if (request.phaseId === "risk-and-bug") {
          riskPrompt = request.prompt;
        }
        if (request.phaseId === "code-quality" || request.phaseId === "risk-and-bug") {
          overlapped ||= activeDetailPhases.size > 0;
          activeDetailPhases.add(request.phaseId);
        }
        await new Promise((resolve) => setTimeout(resolve, request.phaseId === "architecture" ? 5 : 30));
        activeDetailPhases.delete(request.phaseId);
        events.push(`${request.phaseId}:end`);
        await writeFile(request.reportPath, completeMockReport(request.phaseId, request.phaseTitle), "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 30,
          exitCode: 0
        };
      }
    });

    assert.equal(result.exitCode, 0);
    assert.ok(overlapped);
    assert.ok(events.indexOf("architecture:end") < events.indexOf("code-quality:start"));
    assert.ok(events.indexOf("architecture:end") < events.indexOf("risk-and-bug:start"));
    assert.match(riskPrompt, /01-architecture-report\.md/);
    assert.doesNotMatch(riskPrompt, /02-code-quality-report\.md\n\nNot yet available or failed/);
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

test("resume preserves a valid phase report when a forced retry fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-resume-preserve-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const resumeDir = path.join(root, ".repovista", "manual-run");
    await mkdir(resumeDir, { recursive: true });
    const goodReport = completeMockReport("architecture", "Architecture Analysis");
    await writeFile(path.join(resumeDir, "00-inventory.md"), "# Inventory\n\nExisting run.\n", "utf8");
    await writeFile(path.join(resumeDir, "01-architecture-report.md"), goodReport, "utf8");
    await writeFile(path.join(resumeDir, "meta.json"), JSON.stringify({
      phases: [
        {
          id: "architecture",
          title: "Architecture Analysis",
          reportFile: "01-architecture-report.md",
          status: "success",
          qualityPassed: true,
          qualityScore: 100
        }
      ]
    }), "utf8");

    const result = await runAudit({
      command: "audit",
      provider: "codex",
      parallel: "off",
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
      strictReports: true,
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
        await writeFile(request.reportPath, "# Architecture Analysis\n\n## Status\n\nFailed.\n", "utf8");
        return {
          phaseId: request.phaseId,
          success: false,
          reportPath: request.reportPath,
          durationMs: 7,
          exitCode: 1,
          error: "provider retry failed"
        };
      }
    });

    const phase = result.meta.phases.find((item) => item.id === "architecture");
    assert.equal(result.exitCode, 0);
    assert.equal(phase.status, "success");
    assert.equal(phase.preservedPreviousReport, true);
    assert.match(phase.retryError, /provider retry failed/);
    assert.equal(await readFile(path.join(resumeDir, "01-architecture-report.md"), "utf8"), goodReport.endsWith("\n") ? goodReport : `${goodReport}\n`);
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

test("deep review preserves base risk report when one shard fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-deep-partial-"));
  try {
    await mkdir(path.join(root, "src", "alpha"), { recursive: true });
    await mkdir(path.join(root, "src", "beta"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "alpha", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "beta", "b.ts"), "export const b = 1;\n", "utf8");
    await initializeProjectMap(root, DEFAULT_OPTIONS, new Date("2026-05-18T14:57:32.123Z"));

    let failedOneShard = false;
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
        if (request.phaseId.includes("-deep-") && !failedOneShard) {
          failedOneShard = true;
          await writeFile(request.reportPath, "# Failed shard\n\n## Status\n\nFailed.\n", "utf8");
          return {
            phaseId: request.phaseId,
            success: false,
            reportPath: request.reportPath,
            durationMs: 1,
            exitCode: 1,
            error: "shard provider failed"
          };
        }
        const content = request.phaseId.includes("-deep-")
          ? riskReportWithFinding("Successful shard finding", "src/beta/b.ts", "export const b = 1;")
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

    const phase = result.meta.phases.find((item) => item.id === "risk-and-bug");
    assert.equal(result.exitCode, 0);
    assert.equal(phase.status, "success");
    assert.match(phase.error, /deep review shard/);
    assert.ok(phase.deepReviewShards.some((shard) => shard.status === "failed"));
    assert.ok(phase.deepReviewShards.some((shard) => shard.status === "success"));
    assert.match(await readFile(path.join(result.paths.runDir, "03-risk-and-bug-report.md"), "utf8"), /Feature-Sliced Deep Review/);
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
        if (request.phaseId.includes("repair")) {
          assert.ok(request.outputSchema);
          assert.equal(request.outputSchemaKind, "risk-report");
        }
        const content = request.phaseId.includes("repair")
          ? riskReportWithFinding("Repair-added finding", "src/index.ts", "export const value = 1;")
          : "# Risk\n\n## Critical Findings\n\nNo critical findings.\n";
        await writeFile(request.reportPath, content, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0,
          diagnostics: {
            provider: "codex",
            executable: "codex",
            args: [],
            phaseId: request.phaseId,
            phaseTitle: request.phaseTitle,
            startedAt: new Date("2026-05-18T14:57:32.123Z").toISOString(),
            timeoutSeconds: request.timeoutSeconds,
            timedOut: false,
            interrupted: false
          }
        };
      }
    });

    assert.deepEqual(seen, ["risk-and-bug", "risk-and-bug-repair-1"]);
    const riskPhase = result.meta.phases.find((phase) => phase.id === "risk-and-bug");
    assert.equal(riskPhase?.repairAttempts?.length, 1);
    assert.equal(riskPhase.repairAttempts[0].phaseId, "risk-and-bug-repair-1");
    assert.equal(riskPhase.repairAttempts[0].status, "success");
    assert.match(riskPhase.repairAttempts[0].warnings.join("\n"), /Risk findings schema is missing or invalid/);
    assert.equal(riskPhase.providerRun.phaseId, "risk-and-bug");
    assert.equal(riskPhase.repairAttempts[0].providerRun.phaseId, "risk-and-bug-repair-1");
    assert.ok(result.meta.findings.some((finding) => finding.title === "Repair-added finding"));
    assert.match(await readFile(path.join(result.paths.runDir, "index.md"), "utf8"), /RepoVista Run Quality Status/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit cancellation stops before starting later provider phases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-audit-cancel-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const controller = new AbortController();
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
      phases: ["architecture", "code-quality"],
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
      abortSignal: controller.signal,
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
        controller.abort(new Error("test cancellation"));
        await writeFile(request.reportPath, phaseReportMarkdown(request.phaseTitle), "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.equal(result.exitCode, 130);
    assert.deepEqual(seen, ["architecture"]);
    const meta = JSON.parse(await readFile(path.join(result.paths.runDir, "meta.json"), "utf8"));
    assert.equal(meta.exitCode, 130);
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

async function git(cwd, args) {
  const result = await runProcess("git", args, {
    cwd,
    timeoutMs: 30_000,
    stdoutLimit: 1024 * 1024,
    stderrLimit: 1024 * 1024
  });
  assert.equal(result.exitCode, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result;
}

function commandOk(command, args, stdout) {
  return {
    command: [command, ...args].join(" "),
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    stdout
  };
}
