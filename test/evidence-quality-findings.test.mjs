import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  collectEvidence,
  addPromptManifestPhase,
  createPromptManifest,
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

test("schema finding extractor preserves root-level script paths", () => {
  const extraction = extractFindingsWithSource(`# Risk

## Medium Findings

One medium finding.

<!-- repovista-findings:start -->
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "Tray restart loses script context",
      "severity": "medium",
      "category": "Reliability",
      "status": "open",
      "signature": "restart|cwd|claude_status_tray.py",
      "affectedPaths": ["claude_status_tray.py", "usage_cli.py"],
      "evidence": "claude_status_tray.py launches usage_cli.py during status refresh.",
      "evidenceReferences": [
        {
          "path": "claude_status_tray.py",
          "startLine": 12,
          "endLine": 14,
          "quote": "usage_cli.py"
        },
        {
          "path": "usage_cli.py",
          "startLine": 1,
          "endLine": 3,
          "quote": "status"
        }
      ],
      "problemRationale": "Small utility repositories often keep executable scripts at the repository root.",
      "recommendedFix": "Preserve valid root script paths during finding normalization.",
      "reproduction": "Parse a report that references root-level Python scripts.",
      "suggestedRegressionTest": "Assert root script paths survive schema extraction.",
      "minimumFixScope": "Normalize root script paths when explicit schema fields provide them.",
      "estimatedEffort": "small",
      "confidence": "high"
    }
  ]
}
<!-- repovista-findings:end -->
`);

  assert.equal(extraction.source, "schema");
  assert.equal(extraction.findings.length, 1);
  assert.deepEqual(extraction.findings[0].paths, ["claude_status_tray.py", "usage_cli.py"]);
  assert.deepEqual(extraction.findings[0].evidenceDetails.map((reference) => reference.path), ["claude_status_tray.py", "usage_cli.py"]);
  assert.equal(extraction.findings[0].evidenceDetails[0].startLine, 12);
});

test("schema finding extractor preserves explicit dot-directory config paths", () => {
  const extraction = extractFindingsWithSource(`# Risk

## Low Findings

One low finding.

\`\`\`json
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "Local agent permissions are broad",
      "severity": "low",
      "category": "Security",
      "status": "open",
      "signature": "permissions|.claude/settings.local.json",
      "affectedPaths": [".claude/settings.local.json"],
      "evidence": ".claude/settings.local.json allows broad local commands.",
      "evidenceReferences": [
        {
          "path": ".claude/settings.local.json",
          "startLine": 9,
          "endLine": 9,
          "quote": "Bash(sudo apt:*)"
        }
      ],
      "problemRationale": "Project-local agent policy files are valid repository evidence.",
      "recommendedFix": "Keep only the persistent permissions required by this repository.",
      "reproduction": "Parse a report that references the local agent policy file.",
      "suggestedRegressionTest": "Assert explicit dot-directory paths survive schema extraction.",
      "minimumFixScope": "Normalize explicit schema paths without relying only on common source roots.",
      "estimatedEffort": "small",
      "confidence": "high"
    }
  ]
}
\`\`\`
`);

  assert.equal(extraction.source, "schema");
  assert.equal(extraction.findings.length, 1);
  assert.deepEqual(extraction.findings[0].paths, [".claude/settings.local.json"]);
  assert.deepEqual(extraction.findings[0].evidenceDetails.map((reference) => reference.path), [".claude/settings.local.json"]);
});

test("finding extractor preserves expanded evidence paths and line suffixes", () => {
  const extraction = extractFindingsWithSource(`# Risk

## Medium Findings

One medium finding.

\`\`\`json
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "Workspace route loses config evidence",
      "severity": "medium",
      "category": "Reliability",
      "status": "open",
      "signature": "workspace|config|packages/api/src/server.ts",
      "affectedPaths": ["packages/api/src/server.ts:12-14", "config/app.yaml:3"],
      "evidence": "packages/api/src/server.ts and config/app.yaml define the route behavior.",
      "evidenceReferences": ["packages/api/src/server.ts:12-14", {"path":"config/app.yaml:3","quote":"route"}],
      "problemRationale": "Monorepos often keep evidence under package and config roots.",
      "recommendedFix": "Normalize package and config paths with optional line suffixes.",
      "reproduction": "Parse schema evidence with line suffix paths.",
      "suggestedRegressionTest": "Assert path and line range extraction.",
      "minimumFixScope": "Update finding path normalization only.",
      "estimatedEffort": "small",
      "confidence": "high"
    }
  ]
}
\`\`\`
`);

  assert.equal(extraction.source, "schema");
  assert.equal(extraction.findings.length, 1);
  assert.deepEqual(extraction.findings[0].paths, ["config/app.yaml", "packages/api/src/server.ts"]);
  assert.deepEqual(extraction.findings[0].evidenceDetails.map((reference) => ({
    path: reference.path,
    startLine: reference.startLine,
    endLine: reference.endLine
  })), [
    { path: "config/app.yaml", startLine: 3, endLine: 3 },
    { path: "packages/api/src/server.ts", startLine: 12, endLine: 14 }
  ]);

  const markdown = extractFindings(`# Risk

## High Findings

- Title: Router config is incomplete
- Severity: High
- Category: Reliability
- Affected paths: packages/api/src/server.ts:12-14, config/app.yaml:3
- Evidence: packages/api/src/server.ts calls the route and config/app.yaml configures it.
- Recommended fix: Align route config.
- Confidence: High
`);
  assert.deepEqual(markdown[0].paths, ["config/app.yaml", "packages/api/src/server.ts"]);
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

test("evidence validation accepts exact provider-discovered quotes outside prompt manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-evidence-provider-discovered-"));
  try {
    await mkdir(path.join(root, "extensions", "acpx", "src"), { recursive: true });
    await writeFile(path.join(root, "extensions", "acpx", "src", "runtime.ts"), "export const runtime = true;\n", "utf8");
    const finding = {
      id: "fnd_provider_discovered",
      source: "risk-and-bug",
      title: "Provider discovered exact evidence",
      severity: "medium",
      category: "bug",
      paths: ["extensions/acpx/src/runtime.ts"],
      evidenceDetails: [
        {
          path: "extensions/acpx/src/runtime.ts",
          startLine: 1,
          endLine: 1,
          quote: "export const runtime = true;"
        }
      ]
    };

    const validation = await validateFindingEvidence(root, finding, new Set(["README.md"]));
    assert.equal(validation.passed, true);
    assert.equal(validation.references[0].promptIncluded, false);
    assert.equal(validation.references[0].source, "provider-discovered");
    assert.equal(validation.references[0].quoteMatches, true);
    assert.deepEqual(validation.warnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence validation still warns for vague provider-discovered paths outside prompt manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-evidence-provider-vague-"));
  try {
    await mkdir(path.join(root, "extensions", "acpx", "src"), { recursive: true });
    await writeFile(path.join(root, "extensions", "acpx", "src", "runtime.ts"), "export const runtime = true;\n", "utf8");
    const finding = {
      id: "fnd_provider_vague",
      source: "risk-and-bug",
      title: "Provider discovered vague evidence",
      severity: "medium",
      category: "bug",
      paths: ["extensions/acpx/src/runtime.ts"],
      evidenceReferences: ["extensions/acpx/src/runtime.ts"]
    };

    const validation = await validateFindingEvidence(root, finding, new Set(["README.md"]));
    assert.equal(validation.passed, false);
    assert.match(validation.warnings[0], /not part of the provider context manifest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prompt manifest caps omitted file details for large repositories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-prompt-manifest-large-"));
  try {
    const inventoryPath = path.join(root, "inventory.md");
    await writeFile(inventoryPath, "# Inventory\n", "utf8");
    const manifest = createPromptManifest("run", new Date("2026-05-21T00:00:00.000Z"), []);
    const files = Array.from({ length: 900 }, (_, index) => ({
      relativePath: `src/file-${String(index).padStart(4, "0")}.ts`,
      size: 10,
      hashAlgorithm: "sha256",
      sha256: "a".repeat(64),
      scopeReason: "fixture"
    }));

    await addPromptManifestPhase(manifest, {
      phaseId: "risk-and-bug",
      reportFile: "03-risk-and-bug-report.md",
      prompt: "prompt",
      inventoryPath,
      previousReports: {},
      projectFiles: files,
      projectFileLimit: 100,
      omittedProjectFileCount: 25
    });

    const phase = manifest.phases[0];
    assert.equal(phase.includedFiles.filter((file) => file.role === "project-file").length, 100);
    assert.equal(phase.omittedFiles.length, 250);
    assert.equal(phase.omittedFileCount, 825);
    assert.equal(phase.omittedFilesTruncated, true);
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
      exportFormats: ["html", "jsonl"],
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
    const html = await readFile(path.join(result.paths.runDir, "report.html"), "utf8");
    const storedFindings = await loadStoredFindings(root, ".repovista");
    assert.equal(findings[0].severity, "critical");
    assert.match(findings[0].id, /^fnd_/);
    assert.equal(findings[0].evidenceValidation.passed, true);
    assert.equal(summary.findingCounts.critical, 1);
    assert.equal(promptManifest.phases.length, 5);
    assert.equal(features.features.length > 0, true);
    assert.equal(storedFindings[0].id, findings[0].id);
    assert.match(html, /RepoVista Dashboard/);
    assert.match(html, /<details class="finding-card finding-row"/);
    assert.match(html, /Report Sections/);
    assert.match(html, /Report Comparison/);
    assert.match(html, /download>findings\.json/);
    assert.match(html, /class="snippet"/);
    assert.match(html, /Evidence Pack/);
    assert.match(html, /Phase Quality/);
    assert.match(html, /Suppressed Findings/);
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
