import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { renderPrComment, reviewRunDirectory, runPrCommentCommand, runReviewCommand } from "../dist/index.js";

const execFileAsync = promisify(execFile);

test("review command reports weak evidence and PR comment body", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-review-"));
  try {
    const runDir = path.join(root, ".repovista", "run");
    await mkdir(runDir, { recursive: true });
    const findings = [
      {
        id: "fnd_1",
        source: "03-risk-and-bug-report.md",
        title: "High fixture",
        severity: "high",
        paths: ["src/audit.ts"],
        evidenceReferences: ["src/audit.ts"]
      }
    ];
    const structuredReports = ["architecture", "code-quality", "risk-and-bug", "feature-roadmap", "summary"].map((phaseId) => ({
      schemaVersion: 1,
      phaseId,
      source: `${phaseId}.md`,
      keyPoints: ["src/audit.ts"],
      evidenceReferences: phaseId === "summary" ? [] : ["src/audit.ts"],
      recommendations: phaseId === "summary" ? [] : ["Review src/audit.ts"],
      warnings: []
    }));
    await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
      runId: "run",
      options: {
        exportFormats: ["sarif", "html", "jsonl"]
      },
      ai: {
        displayName: "Codex CLI",
        model: "gpt-5.5",
        reasoning: "xhigh"
      },
      evidence: {
        checks: {
          enabled: true,
          commands: ["npm test"]
        },
        git: {}
      },
      repositoryDrift: {
        detected: true,
        warnings: ["Repository changed during audit: commit aaa -> bbb. Revalidate findings before acting on them."]
      },
      findingCounts: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0
      },
      phases: [
        {
          id: "risk-and-bug",
          title: "Risk and Bug Analysis",
          reportFile: "03-risk-and-bug-report.md",
          status: "success",
          durationMs: 2400,
          repairAttempts: [
            {
              attempt: 1,
              phaseId: "risk-and-bug-repair-1",
              status: "success",
              warnings: ["Finding High fixture has invalid evidence: quote does not match line range."],
              durationMs: 1200
            }
          ]
        }
      ]
    }), "utf8");
    await writeFile(path.join(runDir, "findings.json"), JSON.stringify(findings), "utf8");
    await writeFile(path.join(runDir, "structured-reports.json"), JSON.stringify(structuredReports), "utf8");
    await writeFile(path.join(runDir, "summary.json"), JSON.stringify({ runId: "run", findings }), "utf8");
    await writeFile(path.join(runDir, "report.json"), JSON.stringify({ runId: "run", findings }), "utf8");
    await writeFile(path.join(runDir, "prompt-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      runId: "run",
      phases: structuredReports.map((report) => ({ phaseId: report.phaseId, reportFile: report.source, includedFiles: [], omittedFiles: [] }))
    }), "utf8");
    await writeFile(path.join(runDir, "findings.sarif"), JSON.stringify({ version: "2.1.0", runs: [] }), "utf8");
    await writeFile(path.join(runDir, "report.html"), "<!doctype html><html><body>RepoVista</body></html>", "utf8");
    await writeFile(path.join(runDir, "findings.jsonl"), `${JSON.stringify(findings[0])}\n`, "utf8");
    for (const file of ["01-architecture-report.md", "02-code-quality-report.md", "03-risk-and-bug-report.md", "04-feature-roadmap.md", "index.md"]) {
      await writeFile(path.join(runDir, file), "# Fixture\n\nsrc/audit.ts\n", "utf8");
    }

    const reviewed = await reviewRunDirectory(root, ".repovista/run");
    assert.equal(reviewed.weakEvidence.length, 1);
    assert.equal(reviewed.artifactHealth.filter((artifact) => artifact.warnings.length).length, 0);
    assert.match(renderPrComment(reviewed), /High fixture/);

    const markdown = await runReviewCommand({ outDir: ".repovista", reportRunDir: ".repovista/run", json: false }, root);
    assert.match(markdown, /RepoVista Run Review/);
    assert.match(markdown, /Artifact Health/);
    assert.match(markdown, /Repair attempts: 1/);
    assert.match(markdown, /quote does not match line range/);
    assert.match(markdown, /Repository changed during audit/);

    const dryRun = await runPrCommentCommand({ outDir: ".repovista", reportRunDir: ".repovista/run", dryRun: true }, root);
    assert.match(dryRun, /RepoVista PR comment dry run/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review command checks GitHub-source staleness against the source clone", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-review-github-"));
  try {
    const runDir = path.join(root, ".repovista", "run");
    const cloneDir = path.join(root, ".repovista", "sources", "github", "owner", "repo", "abc123");
    await mkdir(runDir, { recursive: true });
    await mkdir(cloneDir, { recursive: true });
    await writeFile(path.join(cloneDir, "README.md"), "# fixture\n", "utf8");
    await execFileAsync("git", ["init"], { cwd: cloneDir });
    await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: cloneDir });
    await execFileAsync("git", ["config", "user.name", "RepoVista Test"], { cwd: cloneDir });
    await execFileAsync("git", ["add", "."], { cwd: cloneDir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: cloneDir });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: cloneDir });
    const sourceCommit = stdout.trim();

    await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
      runId: "run",
      projectRoot: cloneDir,
      source: {
        type: "github",
        repository: "owner/repo",
        owner: "owner",
        repo: "repo",
        url: "https://github.com/owner/repo.git",
        commit: sourceCommit,
        cloneDir,
        fetchedAt: "2026-05-21T00:00:00.000Z"
      },
      options: {
        exportFormats: []
      },
      ai: {
        displayName: "Codex CLI",
        model: "gpt-5.5",
        reasoning: "xhigh"
      },
      evidence: {
        git: {
          commit: sourceCommit
        },
        checks: {
          enabled: false,
          commands: []
        }
      },
      phases: []
    }), "utf8");
    await writeFile(path.join(runDir, "findings.json"), "[]", "utf8");
    await writeFile(path.join(runDir, "structured-reports.json"), "[]", "utf8");
    for (const file of ["01-architecture-report.md", "02-code-quality-report.md", "03-risk-and-bug-report.md", "04-feature-roadmap.md", "index.md"]) {
      await writeFile(path.join(runDir, file), "# Fixture\n\nsrc/audit.ts\n", "utf8");
    }

    const reviewed = await reviewRunDirectory(root, ".repovista/run");
    assert.deepEqual(reviewed.staleWarnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review command refreshes stale evidence validation for exact provider-discovered quotes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-review-evidence-refresh-"));
  try {
    const runDir = path.join(root, ".repovista", "run");
    const cloneDir = path.join(root, ".repovista", "sources", "github", "owner", "repo", "abc123");
    await mkdir(path.join(cloneDir, "extensions", "acpx", "src"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(cloneDir, "extensions", "acpx", "src", "runtime.ts"), "export const runtime = true;\n", "utf8");
    const finding = {
      id: "fnd_exact",
      source: "risk-and-bug",
      title: "Exact quote outside manifest",
      severity: "medium",
      paths: ["extensions/acpx/src/runtime.ts"],
      evidenceDetails: [{
        path: "extensions/acpx/src/runtime.ts",
        startLine: 1,
        endLine: 1,
        quote: "export const runtime = true;"
      }],
      evidenceValidation: {
        checkedAt: "2026-05-21T00:00:00.000Z",
        passed: false,
        warnings: ["Evidence path was not part of the provider context manifest: extensions/acpx/src/runtime.ts"],
        references: []
      }
    };

    await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
      runId: "run",
      projectRoot: cloneDir,
      source: {
        type: "github",
        repository: "owner/repo",
        owner: "owner",
        repo: "repo",
        url: "https://github.com/owner/repo.git",
        commit: "abc123",
        cloneDir,
        fetchedAt: "2026-05-21T00:00:00.000Z"
      },
      options: { exportFormats: [] },
      ai: { displayName: "Codex CLI", model: "gpt-5.5", reasoning: "xhigh" },
      phases: []
    }), "utf8");
    await writeFile(path.join(runDir, "findings.json"), JSON.stringify([finding]), "utf8");
    await writeFile(path.join(runDir, "structured-reports.json"), "[]", "utf8");
    await writeFile(path.join(runDir, "prompt-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      runId: "run",
      phases: [{
        phaseId: "risk-and-bug",
        reportFile: "03-risk-and-bug-report.md",
        includedFiles: [{ path: "README.md", role: "project-file", readable: true }],
        omittedFiles: []
      }]
    }), "utf8");
    for (const file of ["01-architecture-report.md", "02-code-quality-report.md", "03-risk-and-bug-report.md", "04-feature-roadmap.md", "index.md"]) {
      await writeFile(path.join(runDir, file), "# Fixture\n\nextensions/acpx/src/runtime.ts\n", "utf8");
    }

    const reviewed = await reviewRunDirectory(root, ".repovista/run");
    assert.equal(reviewed.weakEvidence.length, 0);
    assert.equal(reviewed.findings[0].evidenceValidation.passed, true);
    assert.equal(reviewed.findings[0].evidenceValidation.references[0].promptIncluded, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
