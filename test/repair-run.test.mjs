import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCliArgs, reviewRunDirectory, runRepairRunCommand } from "../dist/index.js";

test("repair-run rebuilds markdown and structured artifacts from .structured.json", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-repair-run-"));
  try {
    const runDir = path.join(root, ".repovista", "run");
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "b.ts"), "export const b = 1;\n", "utf8");
    await writeFile(path.join(root, "test", "index.test.ts"), "test('value', () => value);\n", "utf8");
    await writeFile(path.join(root, "docs", "notes.md"), "RepoVista fixture notes.\n", "utf8");

    await writeFile(path.join(runDir, "meta.json"), JSON.stringify(metaFixture(root), null, 2), "utf8");
    await writeFile(path.join(runDir, "prompt-manifest.json"), JSON.stringify(promptManifestFixture(), null, 2), "utf8");
    for (const reportFile of ["01-architecture-report.md", "02-code-quality-report.md", "03-risk-and-bug-report.md", "04-feature-roadmap.md", "index.md"]) {
      await writeFile(path.join(runDir, reportFile), "# Broken\n", "utf8");
    }
    await writeStructuredJson(runDir, "01-architecture-report.structured.json", phaseJson("architecture", "Architecture Analysis", [
      "Project Purpose",
      "Tech Stack",
      "Module and Component Overview",
      "Data Flow and Control Flow"
    ]));
    await writeStructuredJson(runDir, "02-code-quality-report.structured.json", phaseJson("code-quality", "Code Quality Analysis", [
      "Biggest Strengths",
      "Biggest Weaknesses",
      "Test Coverage and Test Strategy",
      "Prioritized Recommendations"
    ]));
    await writeStructuredJson(runDir, "03-risk-and-bug-report.structured.json", riskJson());
    await writeStructuredJson(runDir, "04-feature-roadmap.structured.json", phaseJson("feature-roadmap", "Feature and Improvement Roadmap", [
      "Useful Improvements to Existing Features",
      "Useful New Features",
      "Prioritized Roadmap"
    ], roadmapProposals()));
    await writeStructuredJson(runDir, "index.structured.json", phaseJson("summary", "Executive Summary", [
      "Short Conclusion",
      "What the Project Does",
      "Top Strengths",
      "Top Weaknesses",
      "Recommended Order of Next Steps"
    ]));

    const parsed = parseCliArgs(["repair-run", ".repovista/run", "--json"]);
    assert.equal(parsed.action, "repair-run");
    assert.equal(parsed.options.reportRunDir, ".repovista/run");

    const output = await runRepairRunCommand({
      outDir: ".repovista",
      reportRunDir: ".repovista/run",
      json: true,
      force: false
    }, root, new Date("2026-05-19T10:00:00.000Z"));
    const result = JSON.parse(output);
    assert.equal(result.repairedReports.filter((report) => report.status === "repaired").length, 5);
    assert.equal(result.findings, 1);
    assert.equal(result.exitCode, 0);

    const riskReport = await readFile(path.join(runDir, "03-risk-and-bug-report.md"), "utf8");
    assert.match(riskReport, /Risk and Bug Analysis/);
    assert.match(riskReport, /repovista-findings:start/);
    const findings = JSON.parse(await readFile(path.join(runDir, "findings.json"), "utf8"));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].evidenceValidation.passed, true);

    const reviewed = await reviewRunDirectory(root, ".repovista/run");
    assert.equal(reviewed.reportReviews.filter((report) => !report.qualityPassed).length, 0);
    assert.equal(reviewed.artifactHealth.filter((artifact) => artifact.warnings.length).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeStructuredJson(runDir, fileName, value) {
  await writeFile(path.join(runDir, fileName), JSON.stringify(value, null, 2), "utf8");
}

function metaFixture(root) {
  const phases = [
    ["architecture", "Architecture Analysis", "01-architecture-report.md"],
    ["code-quality", "Code Quality Analysis", "02-code-quality-report.md"],
    ["risk-and-bug", "Risk, Bug, and Security Analysis", "03-risk-and-bug-report.md"],
    ["feature-roadmap", "Feature and Improvement Roadmap", "04-feature-roadmap.md"],
    ["summary", "Executive Summary", "index.md"]
  ].map(([id, title, reportFile]) => ({ id, title, reportFile, status: "failed" }));
  return {
    tool: { name: "RepoVista", version: "0.3.0" },
    projectRoot: root,
    reportDir: path.join(root, ".repovista", "run"),
    runId: "run",
    startedAt: "2026-05-19T09:00:00.000Z",
    options: {
      provider: "codex",
      parallel: "auto",
      outDir: ".repovista",
      language: "English",
      json: false,
      includes: [],
      ignores: [],
      phases: [],
      runChecks: false,
      checkCommands: [],
      checkTimeoutSeconds: 60,
      phaseTimeoutSeconds: 60,
      strictReports: true,
      repairReports: true,
      exportFormats: ["sarif", "html", "jsonl"],
      ci: false,
      failOnCritical: false,
      progress: false,
      keepLogs: false
    },
    codex: {
      model: "gpt-5.5",
      profile: "default",
      reasoning: "xhigh",
      fastMode: false,
      sandbox: "read-only"
    },
    ai: {
      provider: "codex",
      displayName: "Codex CLI",
      executable: "codex",
      model: "gpt-5.5",
      profile: "default",
      reasoning: "xhigh",
      fastMode: false,
      sandbox: "read-only"
    },
    preflight: {
      codexAvailable: true,
      providerAvailable: true,
      provider: { id: "codex", displayName: "Codex CLI", executable: "codex", available: true },
      projectRecognized: true,
      gitRepository: false,
      warnings: []
    },
    evidence: {
      collectedAt: "2026-05-19T09:00:00.000Z",
      projectRoot: root,
      runtime: { node: process.version, npm: "10.0.0", platform: process.platform },
      git: { available: false },
      codex: { available: true, version: "codex-cli test" },
      aiProvider: { id: "codex", displayName: "Codex CLI", executable: "codex", available: true },
      checks: { enabled: false, timeoutSeconds: 60, commands: [], results: [] }
    },
    phases,
    findings: [],
    exitCode: 1
  };
}

function promptManifestFixture() {
  const reportFiles = [
    ["architecture", "01-architecture-report.md"],
    ["code-quality", "02-code-quality-report.md"],
    ["risk-and-bug", "03-risk-and-bug-report.md"],
    ["feature-roadmap", "04-feature-roadmap.md"],
    ["summary", "index.md"]
  ];
  const projectFiles = ["src/index.ts", "src/a.ts", "src/b.ts", "test/index.test.ts", "docs/notes.md"];
  return {
    schemaVersion: 1,
    runId: "run",
    createdAt: "2026-05-19T09:00:00.000Z",
    features: [],
    phases: reportFiles.map(([phaseId, reportFile]) => ({
      phaseId,
      reportFile,
      promptBytes: 1000,
      approximateTokens: 250,
      includedFiles: projectFiles.map((filePath) => ({
        path: filePath,
        role: "project-file",
        bytes: 20,
        includedBytes: 0,
        truncated: false,
        readable: true
      })),
      omittedFiles: []
    }))
  };
}

function phaseJson(phaseId, title, headings, proposals = []) {
  return {
    schemaVersion: 1,
    phaseId,
    title,
    executiveSummary: "RepoVista reviewed src/index.ts, src/a.ts, src/b.ts, test/index.test.ts, and docs/notes.md with concrete fixture evidence.",
    sections: headings.map((heading) => ({
      heading,
      body: `${heading} uses src/index.ts, src/a.ts, src/b.ts, test/index.test.ts, and docs/notes.md as fixture evidence with line 1 references.`,
      bullets: ["src/index.ts:1", "src/a.ts:1", "src/b.ts:1", "test/index.test.ts:1", "docs/notes.md:1"]
    })),
    keyPoints: ["src/index.ts and test/index.test.ts define the fixture behavior."],
    evidenceReferences: ["src/index.ts", "src/a.ts", "src/b.ts", "test/index.test.ts", "docs/notes.md"],
    recommendations: ["Keep src/index.ts covered by test/index.test.ts.", "Document behavior in docs/notes.md."],
    proposals
  };
}

function riskJson() {
  return {
    schemaVersion: 1,
    phaseId: "risk-and-bug",
    executiveSummary: "One evidence-backed fixture risk is present.",
    severitySummary: {
      critical: "No critical findings.",
      high: "One high finding.",
      medium: "No medium findings.",
      low: "No low findings."
    },
    findings: [
      {
        title: "Fixture value lacks validation",
        severity: "high",
        category: "Reliability",
        status: "open",
        signature: "fixture|validation|src/index.ts",
        affectedPaths: ["src/index.ts", "src/a.ts", "src/b.ts"],
        evidence: "src/index.ts, src/a.ts, and src/b.ts expose fixture values without validation.",
        evidenceReferences: [
          { path: "src/index.ts", startLine: 1, endLine: 1, quote: "export const value = 1;", symbol: null },
          { path: "src/a.ts", startLine: 1, endLine: 1, quote: "export const a = 1;", symbol: null },
          { path: "src/b.ts", startLine: 1, endLine: 1, quote: "export const b = 1;", symbol: null }
        ],
        problemRationale: "The fixture intentionally lacks validation to exercise finding repair.",
        recommendedFix: "Add a validation guard around the exported fixture value.",
        reproduction: "Inspect src/index.ts and observe the direct value export.",
        suggestedRegressionTest: "Extend test/index.test.ts with a validation assertion.",
        minimumFixScope: "Change src/index.ts and test/index.test.ts only.",
        estimatedEffort: "small",
        confidence: "high",
        findingType: "atomic",
        parentId: null,
        parentTitle: null,
        childFindings: []
      }
    ],
    recommendations: ["Add validation and keep test/index.test.ts aligned."],
    inspected: { files: ["src/index.ts", "src/a.ts", "src/b.ts", "test/index.test.ts"], symbols: ["value"], notes: ["Fixture repair run"] }
  };
}

function roadmapProposals() {
  return Array.from({ length: 6 }, (_, index) => ({
    title: `Proposal ${index + 1}`,
    description: "Improve fixture report ergonomics.",
    evidence: ["src/index.ts", "test/index.test.ts"],
    benefit: "Clearer report validation.",
    effort: "small",
    risk: "Low implementation risk.",
    affected: ["src/index.ts", "test/index.test.ts"],
    steps: ["Update fixture behavior.", "Run npm test."],
    priority: index < 2 ? "P1" : "P2",
    confidence: "high"
  }));
}
