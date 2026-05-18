import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  collectEvidence,
  extractFindings,
  hasFailedChecks,
  renderEvidenceMarkdown,
  validateReportQuality
} from "../dist/index.js";

test("evidence pack records git, codex and local check results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-evidence-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "demo",
      version: "1.2.3",
      scripts: {
        typecheck: "tsc --noEmit",
        test: "node --test"
      }
    }), "utf8");

    const evidence = await collectEvidence(root, {
      command: "audit",
      outDir: ".repovista",
      sandbox: "read-only",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: [],
      runChecks: true,
      checkCommands: ["npm test"],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 1800,
      strictReports: false,
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    }, {
      runCommand: async (command, args, options) => {
        const rendered = [command, ...args].join(" ");
        if (rendered === "npm --version") {
          return ok(rendered, "10.0.0\n");
        }
        if (rendered === "codex --version") {
          return ok(rendered, "codex-cli 0.130.0\n");
        }
        if (rendered === "git rev-parse --is-inside-work-tree") {
          return ok(rendered, "true\n");
        }
        if (rendered === "git branch --show-current") {
          return ok(rendered, "main\n");
        }
        if (rendered === "git rev-parse HEAD") {
          return ok(rendered, "abc123\n");
        }
        if (rendered === "git status --short") {
          return ok(rendered, " M src/index.ts\n");
        }
        if (rendered === "git remote get-url origin") {
          return ok(rendered, "https://github.com/example/demo.git\n");
        }
        assert.equal(options.shell, true);
        return {
          command,
          exitCode: 1,
          durationMs: 12,
          timedOut: false,
          stdout: "failing test\n"
        };
      }
    });

    assert.equal(evidence.packageJson.name, "demo");
    assert.equal(evidence.git.dirty, true);
    assert.equal(evidence.aiProvider.id, "codex");
    assert.equal(evidence.aiProvider.version, "codex-cli 0.130.0");
    assert.equal(evidence.codex.version, "codex-cli 0.130.0");
    assert.equal(hasFailedChecks(evidence), true);
    assert.match(renderEvidenceMarkdown(evidence), /Evidence Pack/);
    assert.match(renderEvidenceMarkdown(evidence), /failing test/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report quality gates and finding extractor expose structured signals", () => {
  const quality = validateReportQuality("risk-and-bug", "# Risk\n\n## Critical Findings\n\nNo critical findings.\n");
  assert.equal(quality.passed, false);
  assert.ok(quality.warnings.some((warning) => /Missing expected section/.test(warning)));

  const findings = extractFindings(`# Risk

## Critical Findings

### Unsafe token handling

- Title: Unsafe token handling
- Severity: Critical
- Category: Security
- Affected paths: src/secrets.ts, README.md
- Evidence: src/secrets.ts masks only package metadata
- Recommended fix: add broader masking coverage
- Confidence: Medium
`);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.deepEqual(findings[0].paths, ["README.md", "src/secrets.ts"]);
});

test("finding extractor prefers explicit paths and avoids prose path noise", () => {
  const findings = extractFindings(`# Risk

## 1. Executive Summary

One high issue is listed below.

## High Findings

- Title: Report and resume paths can write into project code
- Severity: High
- Category: Data loss
- Affected paths: src/reports.ts, src/audit.ts, .github/workflows/security.yml
- Evidence: The app applies path logic in applicable branches and appends report files; src/reports.ts creates run directories.
- Recommended fix: validate report roots before writing
- Confidence: High
`);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Report and resume paths can write into project code");
  assert.deepEqual(findings[0].paths, [".github/workflows/security.yml", "src/audit.ts", "src/reports.ts"]);
});

test("audit writes structured findings and summary json", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-structured-"));
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
      phases: [],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: false,
      ci: true,
      failOnCritical: true,
      progress: false,
      keepLogs: false
    };

    const result = await import("../dist/index.js").then(({ runAudit }) => runAudit(options, {
      cwd: root,
      now: new Date("2026-05-18T14:57:32.123Z"),
      version: "0.1.0",
      commandExists: async () => true,
      runCommand: async (command, args) => ok([command, ...args].join(" "), command === "git" && args[0] === "rev-parse" ? "false\n" : "ok\n"),
      runCodex: async (request) => {
        const content = request.phaseId === "risk-and-bug"
          ? `# Risk

## Executive Summary

One risk.

## Critical Findings

### Unsafe file handling

- Title: Unsafe file handling
- Severity: Critical
- Category: Reliability
- Affected paths: src/index.ts
- Evidence: src/index.ts is the entry point in this fixture
- Recommended fix: add validation
- Confidence: High

## High Findings

No high findings.

## Medium Findings

No medium findings.

## Low Findings

No low findings.

## Recommended Next Steps

- Add tests.
`
          : `# ${request.phaseTitle}

## Executive Summary

Report for ${request.phaseId} references src/index.ts.

## Project Purpose

Demo.

## Tech Stack

TypeScript.

## Module and Component Overview

src/index.ts.

## Data Flow and Control Flow

Simple.

## Recommendations

None.
`;
        await writeFile(request.reportPath, content, "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 5,
          exitCode: 0
        };
      }
    }));

    assert.equal(result.exitCode, 2);
    const findings = JSON.parse(await readFile(path.join(result.paths.runDir, "findings.json"), "utf8"));
    const summary = JSON.parse(await readFile(path.join(result.paths.runDir, "summary.json"), "utf8"));
    assert.equal(findings[0].severity, "critical");
    assert.equal(summary.findingCounts.critical, 1);
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
