import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OPTIONS, runPublishCommand } from "../dist/index.js";

const RUN_ID = "2026-05-21T10-00-00-000Z";
const SHA = "692b99e3481d201ee20284ed04c75d719a134403";

test("publish renders a dry-run GitHub issue from a GitHub source run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-publish-issue-dry-"));
  try {
    await writeGithubRun(root);
    const output = await runPublishCommand({
      ...DEFAULT_OPTIONS,
      findingRunId: RUN_ID,
      findingId: "fnd_test",
      publishTarget: "issue",
      dryRun: true,
      issueLabels: ["triage"]
    }, root);

    assert.match(output, /RepoVista publish dry run/);
    assert.match(output, /creativeprofit22\/contract-and-flow/);
    assert.match(output, /repovista:finding:fnd_test/);
    assert.match(output, new RegExp(`blob/${SHA}/README\\.md#L2`));
    assert.match(output, /Labels: bug, triage/);
    assert.match(output, /Hi,\n\nI found a potential issue in creativeprofit22\/contract-and-flow: Audit-only command allows writes\./);
    assert.match(output, /_Found with \[RepoVista\]\(https:\/\/github\.com\/nordbyte\/RepoVista\)\._/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish translates non-English report findings to English GitHub issues by default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-publish-issue-language-"));
  try {
    await writeGithubRun(root, { language: "German", finding: germanFindingFixture() });
    const providerRequests = [];
    const output = await runPublishCommand({
      ...DEFAULT_OPTIONS,
      findingRunId: RUN_ID,
      findingId: "fnd_test",
      publishTarget: "issue",
      dryRun: true
    }, root, {
      runProvider: async (request) => {
        providerRequests.push(request);
        await writeTranslatedPublishFinding(request.reportPath);
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.equal(providerRequests.length, 1);
    assert.equal(providerRequests[0].outputSchemaKind, "publish-finding");
    assert.match(providerRequests[0].prompt, /Target language: English/);
    assert.match(output, /Title: \[RepoVista\] HIGH: Audit-only command allows writes/);
    assert.match(output, /Write access contradicts audit-only mode/);
    assert.doesNotMatch(output, /Schreibzugriff|Nur-Prüfung|entfernen/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish honors an explicit non-English GitHub issue language", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-publish-issue-explicit-language-"));
  try {
    await writeGithubRun(root, { language: "German", finding: germanFindingFixture() });
    const output = await runPublishCommand({
      ...DEFAULT_OPTIONS,
      findingRunId: RUN_ID,
      findingId: "fnd_test",
      publishTarget: "issue",
      publishLanguage: "Deutsch",
      dryRun: true
    }, root, {
      runProvider: async () => {
        throw new Error("translation should not run when source and target languages match");
      }
    });

    assert.match(output, /Nur-Prüfung-Befehl erlaubt Schreibzugriff/);
    assert.match(output, /Schreibzugriff widerspricht dem Nur-Prüfung-Modus/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish creates a GitHub issue in the source repository and records the link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-publish-issue-"));
  try {
    await writeGithubRun(root);
    const calls = [];
    const output = await runPublishCommand({
      ...DEFAULT_OPTIONS,
      findingRunId: RUN_ID,
      findingId: "fnd_test",
      publishTarget: "issue"
    }, root, {
      now: new Date("2026-05-21T10:30:00.000Z"),
      execFile: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        if (command === "gh" && args[0] === "issue" && args[1] === "list") {
          return { stdout: "[]\n" };
        }
        if (command === "gh" && args[0] === "issue" && args[1] === "create") {
          return { stdout: "https://github.com/creativeprofit22/contract-and-flow/issues/12\n" };
        }
        return { stdout: "" };
      }
    });

    assert.match(output, /created https:\/\/github.com\/creativeprofit22\/contract-and-flow\/issues\/12/);
    const createCall = calls.find((call) => call.command === "gh" && call.args[0] === "issue" && call.args[1] === "create");
    assert.ok(createCall);
    assert.ok(createCall.args.includes("-R"));
    assert.ok(createCall.args.includes("creativeprofit22/contract-and-flow"));
    assert.ok(createCall.args.includes("--body"));
    const body = createCall.args[createCall.args.indexOf("--body") + 1];
    assert.match(body, /Hi,\n\nI found a potential issue in creativeprofit22\/contract-and-flow: Audit-only command allows writes\./);
    assert.match(body, /repovista:finding:fnd_test/);
    assert.match(body, /_Found with \[RepoVista\]\(https:\/\/github\.com\/nordbyte\/RepoVista\)\._/);

    const findings = JSON.parse(await readFile(path.join(root, ".repovista", RUN_ID, "findings.json"), "utf8"));
    assert.equal(findings[0].issue.url, "https://github.com/creativeprofit22/contract-and-flow/issues/12");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish translates non-English report findings to English pull request plans by default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-publish-pr-language-"));
  try {
    await writeGithubRun(root, { language: "German", finding: germanFindingFixture() });
    const output = await runPublishCommand({
      ...DEFAULT_OPTIONS,
      findingRunId: RUN_ID,
      findingId: "fnd_test",
      publishTarget: "pr",
      dryRun: true,
      patchBranch: "repovista/fix-fnd-test"
    }, root, {
      runProvider: async (request) => {
        await writeTranslatedPublishFinding(request.reportPath);
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.match(output, /Finding: fnd_test - Audit-only command allows writes/);
    assert.match(output, /Recommended fix: Remove write access/);
    assert.doesNotMatch(output, /Schreibzugriff|Nur-Prüfung|entfernen/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish creates a fork-backed pull request for a selected finding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-publish-pr-"));
  try {
    await writeGithubRun(root);
    const calls = [];
    const output = await runPublishCommand({
      ...DEFAULT_OPTIONS,
      findingRunId: RUN_ID,
      findingId: "fnd_test",
      publishTarget: "pr",
      runChecks: false,
      patchBranch: "repovista/fix-fnd-test"
    }, root, {
      now: new Date("2026-05-21T10:45:00.000Z"),
      execFile: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        if (command === "git" && args[0] === "clone") {
          const worktree = args.at(-1);
          await mkdir(worktree, { recursive: true });
          await writeFile(path.join(worktree, "README.md"), "before\n", "utf8");
          return { stdout: "" };
        }
        if (command === "git" && args[0] === "rev-parse") {
          return { stdout: `${SHA}\n` };
        }
        if (command === "git" && args[0] === "branch") {
          return { stdout: "main\n" };
        }
        if (command === "git" && args[0] === "status") {
          return { stdout: "" };
        }
        if (command === "git" && args[0] === "diff" && args.includes("--name-only")) {
          return { stdout: "README.md\n" };
        }
        if (command === "git" && args[0] === "diff" && args.includes("--binary")) {
          return { stdout: "diff --git a/README.md b/README.md\n" };
        }
        if (command === "git" && args[0] === "diff") {
          return { stdout: "README.md | 1 +\n" };
        }
        if (command === "git" && args[0] === "push" && args[2] === "origin") {
          throw new Error("no direct access");
        }
        if (command === "gh" && args[0] === "repo" && args[1] === "fork") {
          return { stdout: "" };
        }
        if (command === "gh" && args[0] === "api") {
          return { stdout: "tester\n" };
        }
        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { stdout: "https://github.com/creativeprofit22/contract-and-flow/pull/34\n" };
        }
        return { stdout: "" };
      },
      runProvider: async (request) => {
        await writeFile(path.join(request.projectRoot, "README.md"), "after\n", "utf8");
        await writeFile(request.reportPath, "# Fix\n\nUpdated README.\n", "utf8");
        return {
          phaseId: request.phaseId,
          success: true,
          reportPath: request.reportPath,
          durationMs: 1,
          exitCode: 0
        };
      }
    });

    assert.match(output, /https:\/\/github.com\/creativeprofit22\/contract-and-flow\/pull\/34/);
    const prCall = calls.find((call) => call.command === "gh" && call.args[0] === "pr" && call.args[1] === "create");
    assert.ok(prCall);
    assert.equal(prCall.args[prCall.args.indexOf("--head") + 1], "tester:repovista/fix-fnd-test");
    const prBody = prCall.args[prCall.args.indexOf("--body") + 1];
    assert.match(prBody, /Hi,\n\nI opened this PR to address a RepoVista finding in creativeprofit22\/contract-and-flow: Audit-only command allows writes\./);
    assert.match(prBody, /_Found with \[RepoVista\]\(https:\/\/github\.com\/nordbyte\/RepoVista\)\._/);
    const patchFiles = await readdir(path.join(root, ".repovista", "patches"));
    assert.ok(patchFiles.some((file) => file.endsWith(".json")));
    const findings = JSON.parse(await readFile(path.join(root, ".repovista", RUN_ID, "findings.json"), "utf8"));
    assert.equal(findings[0].pullRequest.url, "https://github.com/creativeprofit22/contract-and-flow/pull/34");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeGithubRun(root, options = {}) {
  const language = options.language ?? "English";
  const finding = options.finding ?? findingFixture();
  const outRoot = path.join(root, ".repovista");
  const runDir = path.join(outRoot, RUN_ID);
  const cloneDir = path.join(outRoot, "sources", "github", "creativeprofit22", "contract-and-flow", SHA.slice(0, 12));
  await mkdir(runDir, { recursive: true });
  await mkdir(cloneDir, { recursive: true });
  await writeFile(path.join(cloneDir, "README.md"), "line 1\nline 2\n", "utf8");
  const meta = {
    tool: { name: "RepoVista", version: "0.4.0" },
    projectRoot: cloneDir,
    reportDir: runDir,
    runId: RUN_ID,
    startedAt: "2026-05-21T10:00:00.000Z",
    completedAt: "2026-05-21T10:01:00.000Z",
    options: { outDir: ".repovista", provider: "codex", parallel: "auto", language, json: false, includes: [], ignores: [], phases: [], runChecks: false, checkCommands: [], checkTimeoutSeconds: 300, phaseTimeoutSeconds: 1800, strictReports: true, repairReports: true, exportFormats: [], ci: false, failOnCritical: false, progress: false, keepLogs: false },
    source: {
      type: "github",
      repository: "creativeprofit22/contract-and-flow",
      owner: "creativeprofit22",
      repo: "contract-and-flow",
      url: "https://github.com/creativeprofit22/contract-and-flow.git",
      defaultBranch: "main",
      commit: SHA,
      cloneDir,
      fetchedAt: "2026-05-21T10:00:00.000Z"
    },
    codex: { model: "gpt-5.5", profile: "none", reasoning: "xhigh", fastMode: false, sandbox: "read-only" },
    ai: { provider: "codex", displayName: "Codex CLI", executable: "codex", model: "gpt-5.5", profile: "none", reasoning: "xhigh", fastMode: false, sandbox: "read-only" },
    preflight: { codexAvailable: true, providerAvailable: true, provider: { id: "codex", displayName: "Codex CLI", executable: "codex", available: true }, projectRecognized: true, gitRepository: true, warnings: [] },
    phases: [],
    findings: [],
    exitCode: 0
  };
  const findings = [finding];
  await writeFile(path.join(runDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`, "utf8");
}

async function writeTranslatedPublishFinding(reportPath) {
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    language: "English",
    title: "Audit-only command allows writes",
    category: "bug",
    evidence: "README line 2 shows the issue.",
    problemRationale: "Write access contradicts audit-only mode.",
    recommendedFix: "Remove write access.",
    reproduction: "Run the audit-only command and inspect its declared permissions.",
    suggestedRegressionTest: "Assert command manifests do not include write tools.",
    minimumFixScope: "README.md"
  }, null, 2)}\n`, "utf8");
}

function findingFixture() {
  return {
    id: "fnd_test",
    source: "risk-and-bug",
    title: "Audit-only command allows writes",
    severity: "high",
    category: "bug",
    status: "open",
    confidence: "high",
    labels: ["bug"],
    paths: ["README.md"],
    evidence: "README line 2 shows the issue.",
    evidenceDetails: [{ path: "README.md", startLine: 2, endLine: 2, quote: "line 2" }],
    recommendation: "Remove write access.",
    problemRationale: "Write access contradicts audit-only mode.",
    suggestedRegressionTest: "Assert command manifests do not include write tools.",
    minimumFixScope: "README.md"
  };
}

function germanFindingFixture() {
  return {
    ...findingFixture(),
    title: "Nur-Prüfung-Befehl erlaubt Schreibzugriff",
    category: "Fehler",
    evidence: "README Zeile 2 zeigt das Problem.",
    recommendation: "Schreibzugriff entfernen.",
    problemRationale: "Schreibzugriff widerspricht dem Nur-Prüfung-Modus.",
    reproduction: "Den Nur-Prüfung-Befehl ausführen und die Berechtigungen prüfen.",
    suggestedRegressionTest: "Sicherstellen, dass Befehlsmanifeste keine Schreibwerkzeuge enthalten."
  };
}
