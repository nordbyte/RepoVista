import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAuditProfile,
  assertSettingsMenuRegistryCoverage,
  CLI_OPTIONS,
  DEFAULT_OPTIONS,
  OPTION_REGISTRY,
  parseCliArgs,
  SETTING_DEFINITIONS,
  validateSandbox
} from "../dist/index.js";

test("default command runs audit with safe defaults", () => {
  const parsed = parseCliArgs([]);

  assert.equal(parsed.action, "audit");
  assert.equal(parsed.options.outDir, ".repovista");
  assert.equal(parsed.options.provider, "codex");
  assert.equal(parsed.options.parallel, "auto");
  assert.equal(parsed.options.sandbox, "read-only");
  assert.equal(parsed.options.language, "English");
  assert.equal(parsed.options.reasoning, "xhigh");
  assert.equal(parsed.options.fastMode, false);
  assert.equal(parsed.options.runChecks, true);
  assert.equal(parsed.options.strictReports, true);
  assert.equal(parsed.options.repairReports, true);
  assert.equal(parsed.options.incremental, true);
  assert.equal(parsed.options.snapshot, false);
  assert.deepEqual(parsed.options.exportFormats, ["sarif", "html", "jsonl"]);
  assert.equal(parsed.options.progress, true);
});

test("explicit audit command parses supported options", () => {
  const parsed = parseCliArgs([
    "audit",
    "--provider",
    "claude",
    "--parallel",
    "3",
    "--out",
    "reports",
    "--github-repo",
    "nordbyte/RepoVista",
    "--github-ref",
    "main",
    "--model=gpt-5.5",
    "--profile",
    "review",
    "--reasoning",
    "high",
    "--fast",
    "--sandbox",
    "workspace-write",
    "--language",
    "English",
    "--json",
    "--include",
    "src/**,README.md",
    "--ignore",
    "fixtures/**",
    "--phase",
    "risk-and-bug,summary",
    "--run-checks",
    "--deep-review",
    "--check",
    "npm run typecheck",
    "--check-timeout",
    "2",
    "--timeout",
    "45",
    "--since",
    "origin/main",
    "--strict-reports",
    "--snapshot",
    "--ci",
    "--fail-on-critical",
    "--fail-on-drift",
    "--fail-on-weak-evidence",
    "--min-quality-score",
    "80",
    "--max-critical",
    "0",
    "--max-high",
    "2",
    "--max-medium",
    "5",
    "--keep-logs"
  ]);

  assert.equal(parsed.action, "audit");
  assert.equal(parsed.options.provider, "claude");
  assert.equal(parsed.options.parallel, 3);
  assert.equal(parsed.options.outDir, "reports");
  assert.equal(parsed.options.githubRepo, "nordbyte/RepoVista");
  assert.equal(parsed.options.githubRef, "main");
  assert.equal(parsed.options.model, "gpt-5.5");
  assert.equal(parsed.options.profile, "review");
  assert.equal(parsed.options.reasoning, "high");
  assert.equal(parsed.options.fastMode, true);
  assert.equal(parsed.options.sandbox, "workspace-write");
  assert.equal(parsed.options.language, "English");
  assert.equal(parsed.options.json, true);
  assert.deepEqual(parsed.options.includes, ["src/**", "README.md"]);
  assert.deepEqual(parsed.options.ignores, ["fixtures/**"]);
  assert.deepEqual(parsed.options.phases, ["risk-and-bug", "summary"]);
  assert.equal(parsed.options.runChecks, true);
  assert.equal(parsed.options.deepReview, true);
  assert.deepEqual(parsed.options.checkCommands, ["npm run typecheck"]);
  assert.equal(parsed.options.checkTimeoutSeconds, 120);
  assert.equal(parsed.options.phaseTimeoutSeconds, 2700);
  assert.equal(parsed.options.since, "origin/main");
  assert.equal(parsed.options.strictReports, true);
  assert.equal(parsed.options.snapshot, true);
  assert.equal(parsed.options.ci, true);
  assert.equal(parsed.options.progress, false);
  assert.equal(parsed.options.failOnCritical, true);
  assert.equal(parsed.options.failOnDrift, true);
  assert.equal(parsed.options.failOnWeakEvidence, true);
  assert.equal(parsed.options.minQualityScore, 80);
  assert.equal(parsed.options.maxCritical, 0);
  assert.equal(parsed.options.maxHigh, 2);
  assert.equal(parsed.options.maxMedium, 5);
  assert.equal(parsed.options.keepLogs, true);
});

test("explicit export options replace built-in or saved export defaults", () => {
  assert.deepEqual(parseCliArgs(["audit", "--export", "github"]).options.exportFormats, ["github"]);
  assert.deepEqual(parseCliArgs(["findings"]).options.exportFormats, []);
  assert.deepEqual(parseCliArgs(["findings", "--export", "sarif"]).options.exportFormats, ["sarif"]);
  assert.equal(parseCliArgs(["findings", "--run", "run-1"]).options.findingRunId, "run-1");

  const savedDefaults = {
    ...DEFAULT_OPTIONS,
    exportFormats: ["sarif"],
    exportFormatsExplicit: true
  };
  assert.deepEqual(parseCliArgs(["audit", "--export", "github"], savedDefaults).options.exportFormats, ["github"]);
});

test("danger-full-access sandbox is rejected", () => {
  assert.throws(() => validateSandbox("danger-full-access"), /Dangerous sandbox mode/);
});

test("unknown options fail clearly", () => {
  assert.throws(() => parseCliArgs(["--unknown"]), /Unknown option/);
});

test("unknown provider fails clearly", () => {
  assert.throws(() => parseCliArgs(["--provider", "unknown"]), /Unknown provider/);
});

test("init and plan commands are recognized", () => {
  assert.equal(parseCliArgs(["init"]).action, "init");
  assert.equal(parseCliArgs(["plan", "--parallel", "auto"]).action, "plan");
  assert.equal(parseCliArgs(["plan", "--parallel", "auto"]).options.parallel, "auto");
  assert.equal(parseCliArgs(["plan", "--refresh"]).options.refresh, true);
  assert.equal(parseCliArgs(["audit", "--no-parallel"]).options.parallel, "off");
  assert.throws(() => parseCliArgs(["--parallel", "9"]), /--parallel/);
});

test("settings command is recognized", () => {
  const parsed = parseCliArgs(["settings"]);
  assert.equal(parsed.action, "settings");
});

test("compare command requires old and new run directories", () => {
  const parsed = parseCliArgs(["compare", ".repovista/old", ".repovista/new"]);
  assert.equal(parsed.action, "compare");
  assert.equal(parsed.options.compareOldRun, ".repovista/old");
  assert.equal(parsed.options.compareNewRun, ".repovista/new");
  assert.throws(() => parseCliArgs(["compare", ".repovista/old"]), /requires two run directories/);
});

test("finding workflow commands are recognized", () => {
  const next = parseCliArgs(["next", "--status", "uncertain"]);
  assert.equal(next.action, "next");
  assert.equal(next.options.findingStatus, "uncertain");

  const show = parseCliArgs(["show", "fnd_123"]);
  assert.equal(show.action, "show");
  assert.equal(show.options.findingId, "fnd_123");

  const triage = parseCliArgs(["triage", "fnd_123", "--status", "false-positive", "--note", "fixture"]);
  assert.equal(triage.action, "triage");
  assert.equal(triage.options.findingStatus, "false-positive");
  assert.equal(triage.options.note, "fixture");

  const revalidate = parseCliArgs(["revalidate", "--all"]);
  assert.equal(revalidate.action, "revalidate");
  assert.equal(revalidate.options.allFindings, true);
  assert.throws(() => parseCliArgs(["triage", "fnd_123", "--status", "ignored"]), /--status/);
});

test("new operational commands and options are recognized", () => {
  const doctor = parseCliArgs(["doctor", "--json"]);
  assert.equal(doctor.action, "doctor");
  assert.equal(doctor.options.json, true);

  const providers = parseCliArgs(["providers", "test", "codex"]);
  assert.equal(providers.action, "providers");
  assert.equal(providers.options.providerAction, "test");
  assert.equal(providers.options.provider, "codex");

  assert.equal(parseCliArgs(["providers", "test", "gemini"]).options.provider, "gemini");

  const review = parseCliArgs(["review", ".repovista/run", "--json"]);
  assert.equal(review.action, "review");
  assert.equal(review.options.reportRunDir, ".repovista/run");
  assert.equal(review.options.json, true);

  const prComment = parseCliArgs(["pr-comment", ".repovista/run", "--dry-run"]);
  assert.equal(prComment.action, "pr-comment");
  assert.equal(prComment.options.reportRunDir, ".repovista/run");
  assert.equal(prComment.options.dryRun, true);

  const baseline = parseCliArgs(["baseline", "add", "fnd_123", "--note", "accepted"]);
  assert.equal(baseline.action, "baseline");
  assert.equal(baseline.options.baselineAction, "add");
  assert.equal(baseline.options.findingId, "fnd_123");

  const suppress = parseCliArgs(["suppress", "fnd_123"]);
  assert.equal(suppress.action, "suppress");
  assert.equal(suppress.options.baselineAction, "add");

  const ci = parseCliArgs(["ci", "init", "--dry-run", "--force", "--template", "security"]);
  assert.equal(ci.action, "ci-init");
  assert.equal(ci.options.dryRun, true);
  assert.equal(ci.options.force, true);
  assert.equal(ci.options.ciTemplate, "security");

  const compare = parseCliArgs(["compare", "old", "new", "--format", "json", "--fail-on-regression", "--max-new-high", "0"]);
  assert.equal(compare.options.compareFormat, "json");
  assert.equal(compare.options.compareFailOnRegression, true);
  assert.equal(compare.options.maxNewHigh, 0);

  const cleanLocks = parseCliArgs(["clean-locks", "--force"]);
  assert.equal(cleanLocks.action, "clean-locks");
  assert.equal(cleanLocks.options.force, true);

  const fix = parseCliArgs(["fix", "fnd_123,fnd_456", "--dry-run", "--isolate-branch", "--no-isolate", "--post-revalidate", "--max-files", "4"]);
  assert.equal(fix.action, "fix");
  assert.equal(fix.options.findingId, "fnd_123,fnd_456");
  assert.equal(fix.options.dryRun, true);
  assert.equal(fix.options.fixIsolateBranch, true);
  assert.equal(fix.options.fixNoIsolate, true);
  assert.equal(fix.options.fixPostRevalidate, true);
  assert.equal(fix.options.patchMaxFiles, 4);

  const plugin = parseCliArgs(["audit", "--allow-repo-provider-plugin"]);
  assert.equal(plugin.options.allowRepoProviderPlugin, true);

  const patches = parseCliArgs(["patches", "pat_123"]);
  assert.equal(patches.action, "patches");
  assert.equal(patches.options.patchId, "pat_123");

  const rollback = parseCliArgs(["rollback", "pat_123", "--dry-run"]);
  assert.equal(rollback.action, "rollback");
  assert.equal(rollback.options.patchId, "pat_123");
  assert.equal(rollback.options.dryRun, true);

  const openPr = parseCliArgs(["open-pr", "pat_123", "--branch", "repovista/fix", "--title", "Fix"]);
  assert.equal(openPr.action, "open-pr");
  assert.equal(openPr.options.patchId, "pat_123");
  assert.equal(openPr.options.patchBranch, "repovista/fix");
  assert.equal(openPr.options.patchTitle, "Fix");

  const publish = parseCliArgs(["publish", "fnd_123", "--run", "2026-run", "--as", "pr", "--fork", "--dry-run"]);
  assert.equal(publish.action, "publish");
  assert.equal(publish.options.findingId, "fnd_123");
  assert.equal(publish.options.findingRunId, "2026-run");
  assert.equal(publish.options.publishTarget, "pr");
  assert.equal(publish.options.publishFork, true);
  assert.equal(publish.options.dryRun, true);

  assert.equal(parseCliArgs(["findings-ui"]).action, "findings-ui");
  assert.equal(parseCliArgs(["reports"]).action, "reports");
  assert.throws(() => parseCliArgs(["reports-ui"]), /Unknown command/);
  assert.throws(() => parseCliArgs(["publish", "fnd_123", "--as", "comment"]), /--as/);
});

test("audit profiles, workspaces, issue metadata, and incremental mode parse", () => {
  const parsed = parseCliArgs([
    "audit",
    "--audit-profile",
    "release-readiness",
    "--review-mode",
    "deslopify",
    "--prompt-file",
    "review.md",
    "--workspace",
    "packages/api",
    "--all-workspaces",
    "--workspace-matrix",
    "--incremental",
    "--label",
    "repovista",
    "--assignee",
    "octocat",
    "--update-existing",
    "--sync-issues",
    "--reopen-issues",
    "--owner-rule",
    "packages/api/**=team-api",
    "--label-rule",
    "packages/api/**=area-api",
    "--sla-days",
    "14"
  ]);

  assert.equal(parsed.options.auditProfile, "release-readiness");
  assert.equal(parsed.options.reviewMode, "deslopify");
  assert.equal(parsed.options.promptFile, "review.md");
  assert.equal(parsed.options.workspace, "packages/api");
  assert.equal(parsed.options.allWorkspaces, true);
  assert.equal(parsed.options.workspaceMatrix, true);
  assert.equal(parsed.options.incremental, true);
  assert.deepEqual(parsed.options.issueLabels, ["repovista"]);
  assert.deepEqual(parsed.options.issueAssignees, ["octocat"]);
  assert.equal(parsed.options.issueUpdateExisting, true);
  assert.equal(parsed.options.issueSync, true);
  assert.equal(parsed.options.issueReopen, true);
  assert.deepEqual(parsed.options.ownerRules, ["packages/api/**=team-api"]);
  assert.deepEqual(parsed.options.labelRules, ["packages/api/**=area-api"]);
  assert.equal(parsed.options.slaDays, 14);
  assert.throws(() => parseCliArgs(["audit", "--owner-rule", "broken"]), /path-glob=value/);
});

test("explicit no-run-checks wins over audit profile defaults", () => {
  const parsed = parseCliArgs(["audit", "--audit-profile", "pr-review", "--no-run-checks", "--no-parallel"]);
  const profiled = applyAuditProfile(parsed.options);

  assert.equal(profiled.runChecks, false);
  assert.equal(profiled.parallel, "off");
});

test("option registry feeds CLI help, settings and menu metadata", () => {
  const registryCliNames = new Set(OPTION_REGISTRY.map((entry) => entry.cli?.name).filter(Boolean));
  const registrySettingKeys = new Set(OPTION_REGISTRY.map((entry) => entry.setting?.key).filter(Boolean));

  for (const option of CLI_OPTIONS) {
    assert.equal(registryCliNames.has(option.name), true, `missing CLI option registry entry: ${option.name}`);
  }
  for (const setting of SETTING_DEFINITIONS) {
    assert.equal(registrySettingKeys.has(setting.key), true, `missing setting registry entry: ${setting.key}`);
  }
  assert.deepEqual(assertSettingsMenuRegistryCoverage(), []);
  assert.deepEqual(DEFAULT_OPTIONS.exportFormats, ["sarif", "html", "jsonl"]);
});
