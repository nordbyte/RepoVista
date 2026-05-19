import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  collectEvidence,
  extractFindings,
  extractFindingsWithSource,
  hasFailedChecks,
  loadStoredFindings,
  renderEvidenceMarkdown,
  validateFindingEvidence,
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

test("finding extractor uses schema findings before markdown fallback", () => {
  const extraction = extractFindingsWithSource(`# Risk

## Critical Findings

- Title: Markdown-only title
- Severity: Critical
- Affected paths: src/legacy.ts

\`\`\`json
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "Schema title",
      "severity": "high",
      "category": "security",
      "status": "open",
      "signature": "high|security|src/schema.ts|Schema title",
      "affectedPaths": ["src/schema.ts"],
      "evidence": "src/schema.ts validates the report schema",
      "evidenceReferences": [
        {
          "path": "src/schema.ts",
          "startLine": 1,
          "endLine": 1,
          "quote": "validate schema"
        }
      ],
      "problemRationale": "The schema is the source of truth.",
      "recommendedFix": "Keep the schema valid.",
      "reproduction": "Inspect src/schema.ts and confirm schema handling is used.",
      "suggestedRegressionTest": "Add a parser test for schema-first extraction.",
      "minimumFixScope": "Keep the schema parser path intact.",
      "estimatedEffort": "small",
      "confidence": "high"
    }
  ]
}
\`\`\`
`);

  assert.equal(extraction.source, "schema");
  assert.equal(extraction.findings.length, 1);
  assert.equal(extraction.findings[0].title, "Schema title");
  assert.equal(extraction.findings[0].severity, "high");
  assert.deepEqual(extraction.findings[0].paths, ["src/schema.ts"]);

  const quality = validateReportQuality("risk-and-bug", `# Risk

## Executive Summary

One issue.

## Critical Findings

No critical findings.

## High Findings

One high finding.

## Medium Findings

No medium findings.

## Low Findings

No low findings.

## Recommended Next Steps

Fix src/schema.ts, src/index.ts and test/schema.test.ts.

\`\`\`json
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "Schema title",
      "severity": "high",
      "category": "security",
      "status": "open",
      "signature": "high|security|src/schema.ts|Schema title",
      "affectedPaths": ["src/schema.ts"],
      "evidence": "src/schema.ts and test/schema.test.ts cover schema extraction",
      "evidenceReferences": [
        {
          "path": "src/schema.ts",
          "startLine": 1,
          "endLine": 1,
          "quote": "schema extraction"
        },
        {
          "path": "test/schema.test.ts",
          "startLine": 1,
          "endLine": 1
        }
      ],
      "problemRationale": "The parser depends on valid structured fields.",
      "recommendedFix": "Keep schema validation in place.",
      "reproduction": "Run the schema parser against a report with a findings block.",
      "suggestedRegressionTest": "Assert that schema findings are preferred over markdown fallback.",
      "minimumFixScope": "Update the parser and quality gate only.",
      "estimatedEffort": "small",
      "confidence": "high"
    }
  ]
}
\`\`\`
`);
  assert.equal(quality.passed, true);
});

test("schema extractor handles sentinel JSON, fenced quote text and parent child findings", () => {
  const schema = {
    schemaVersion: 1,
    findings: [
      {
        title: "Project scripts can bypass no-run-checks",
        severity: "low",
        category: "Reliability",
        status: "open",
        signature: "settings|no-run-checks|src/profiles.ts",
        affectedPaths: ["src/profiles.ts"],
        evidence: "src/profiles.ts enables run checks from profiles.",
        evidenceReferences: [
          {
            path: "src/profiles.ts",
            startLine: 1,
            endLine: 3,
            quote: "const fenced = \"```json\";"
          }
        ],
        problemRationale: "An explicit --no-run-checks choice must not be overridden by profiles.",
        recommendedFix: "Track explicit CLI booleans and let them win over profile defaults.",
        reproduction: "Run a profile with --no-run-checks and inspect the resolved options.",
        suggestedRegressionTest: "Assert --audit-profile pr-review --no-run-checks keeps runChecks false.",
        minimumFixScope: "Change profile option merging only.",
        estimatedEffort: "small",
        confidence: "high",
        childFindings: [
          {
            title: "Profile merge ignores explicit run check disable",
            severity: "medium",
            category: "Reliability",
            status: "open",
            signature: "settings|child|src/options.ts",
            affectedPaths: ["src/options.ts"],
            evidence: "src/options.ts parses no-run-checks.",
            evidenceReferences: [
              {
                path: "src/options.ts",
                startLine: 1,
                endLine: 2,
                quote: "no-run-checks"
              }
            ],
            problemRationale: "The parser must preserve whether the user explicitly disabled checks.",
            recommendedFix: "Record an explicit runChecks flag while parsing.",
            reproduction: "Parse audit --audit-profile pr-review --no-run-checks.",
            suggestedRegressionTest: "Assert the parsed and profiled options keep runChecks false.",
            minimumFixScope: "Add explicit boolean tracking to options/profile handling.",
            estimatedEffort: "small",
            confidence: "high"
          }
        ]
      }
    ]
  };

  const extraction = extractFindingsWithSource(`# Risk

## Critical Findings

- Title: Markdown fallback should be ignored
- Severity: Critical

<!-- repovista-findings:start -->
${JSON.stringify(schema, null, 2)}
<!-- repovista-findings:end -->
`);

  assert.equal(extraction.source, "schema");
  assert.equal(extraction.findings.length, 2);
  assert.equal(extraction.findings[0].severity, "high");
  assert.ok(extraction.findings.some((finding) => finding.findingType === "theme"));
  assert.ok(extraction.findings.some((finding) => finding.parentTitle === "Project scripts can bypass no-run-checks"));
});

test("schema findings get stable ids and validated evidence details", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-evidence-validation-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "schema.ts"), "export function validateSchema() {\n  return true;\n}\n", "utf8");

    const report = `# Risk

## Executive Summary

One issue.

## Critical Findings

No critical findings.

## High Findings

One high finding.

## Medium Findings

No medium findings.

## Low Findings

No low findings.

## Recommended Next Steps

Fix src/schema.ts, src/index.ts and test/schema.test.ts.

\`\`\`json
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "Schema title",
      "severity": "high",
      "category": "security",
      "affectedPaths": ["src/schema.ts"],
      "evidence": "src/schema.ts validates the report schema",
      "evidenceReferences": [
        {
          "path": "src/schema.ts",
          "startLine": 1,
          "endLine": 1,
          "quote": "export function validateSchema"
        }
      ],
      "problemRationale": "The parser depends on valid structured fields.",
      "recommendedFix": "Keep schema validation in place.",
      "reproduction": "Run extraction for a report that references src/schema.ts.",
      "suggestedRegressionTest": "Assert evidence validation succeeds for the exact quote.",
      "minimumFixScope": "Keep evidence reference parsing and validation aligned.",
      "estimatedEffort": "small",
      "confidence": "high"
    }
  ]
}
\`\`\`
`;
    const first = extractFindings(report)[0];
    const second = extractFindings(report)[0];
    assert.match(first.id, /^fnd_[a-f0-9]{12}$/);
    assert.equal(first.id, second.id);
    assert.equal(first.status, "open");
    assert.equal(first.evidenceDetails[0].startLine, 1);
    assert.equal(first.evidenceDetails[0].quote, "export function validateSchema");

    const validation = await validateFindingEvidence(root, first, new Set(["src"]));
    assert.equal(validation.passed, true);
    assert.equal(validation.references[0].quoteMatches, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
        const content = request.phaseId.startsWith("risk-and-bug")
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

\`\`\`json
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "Unsafe file handling",
      "severity": "critical",
      "category": "reliability",
      "affectedPaths": ["src/index.ts"],
      "evidence": "src/index.ts is the entry point in this fixture; package.json and test/index.test.ts document the fixture boundary.",
      "evidenceReferences": [
        {
          "path": "src/index.ts",
          "startLine": 1,
          "endLine": 1,
          "quote": "export const value = 1;"
        }
      ],
      "problemRationale": "The entry point lacks the expected validation in this fixture.",
      "recommendedFix": "add validation",
      "reproduction": "Inspect src/index.ts and observe there is no validation around the exported value.",
      "suggestedRegressionTest": "Add a test that fails when validation is absent.",
      "minimumFixScope": "Add validation in src/index.ts and cover it with a focused test.",
      "estimatedEffort": "small",
      "confidence": "high"
    }
  ]
}
\`\`\`
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
    const promptManifest = JSON.parse(await readFile(path.join(result.paths.runDir, "prompt-manifest.json"), "utf8"));
    const features = JSON.parse(await readFile(path.join(result.paths.runDir, "features.json"), "utf8"));
    const storedFindings = await loadStoredFindings(root, ".repovista");
    assert.equal(findings[0].severity, "critical");
    assert.match(findings[0].id, /^fnd_/);
    assert.equal(findings[0].evidenceValidation.passed, true);
    assert.equal(summary.findingCounts.critical, 1);
    assert.equal(promptManifest.phases.length, 5);
    assert.equal(features.features.length > 0, true);
    assert.equal(storedFindings[0].id, findings[0].id);
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
