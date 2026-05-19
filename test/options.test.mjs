import test from "node:test";
import assert from "node:assert/strict";
import { applyAuditProfile, parseCliArgs, validateSandbox } from "../dist/index.js";

test("default command runs audit with safe defaults", () => {
  const parsed = parseCliArgs([]);

  assert.equal(parsed.action, "audit");
  assert.equal(parsed.options.outDir, ".repovista");
  assert.equal(parsed.options.provider, "codex");
  assert.equal(parsed.options.parallel, "off");
  assert.equal(parsed.options.sandbox, "read-only");
  assert.equal(parsed.options.language, "English");
  assert.equal(parsed.options.fastMode, false);
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
    "--ci",
    "--fail-on-critical",
    "--keep-logs"
  ]);

  assert.equal(parsed.action, "audit");
  assert.equal(parsed.options.provider, "claude");
  assert.equal(parsed.options.parallel, 3);
  assert.equal(parsed.options.outDir, "reports");
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
  assert.equal(parsed.options.ci, true);
  assert.equal(parsed.options.progress, false);
  assert.equal(parsed.options.failOnCritical, true);
  assert.equal(parsed.options.keepLogs, true);
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

  const baseline = parseCliArgs(["baseline", "add", "fnd_123", "--note", "accepted"]);
  assert.equal(baseline.action, "baseline");
  assert.equal(baseline.options.baselineAction, "add");
  assert.equal(baseline.options.findingId, "fnd_123");

  const suppress = parseCliArgs(["suppress", "fnd_123"]);
  assert.equal(suppress.action, "suppress");
  assert.equal(suppress.options.baselineAction, "add");

  const ci = parseCliArgs(["ci", "init", "--dry-run", "--force"]);
  assert.equal(ci.action, "ci-init");
  assert.equal(ci.options.dryRun, true);
  assert.equal(ci.options.force, true);

  const compare = parseCliArgs(["compare", "old", "new", "--format", "json", "--fail-on-regression"]);
  assert.equal(compare.options.compareFormat, "json");
  assert.equal(compare.options.compareFailOnRegression, true);

  const cleanLocks = parseCliArgs(["clean-locks", "--force"]);
  assert.equal(cleanLocks.action, "clean-locks");
  assert.equal(cleanLocks.options.force, true);

  const fix = parseCliArgs(["fix", "fnd_123", "--dry-run"]);
  assert.equal(fix.action, "fix");
  assert.equal(fix.options.findingId, "fnd_123");
  assert.equal(fix.options.dryRun, true);

  const patches = parseCliArgs(["patches", "pat_123"]);
  assert.equal(patches.action, "patches");
  assert.equal(patches.options.patchId, "pat_123");

  const openPr = parseCliArgs(["open-pr", "pat_123", "--branch", "repovista/fix", "--title", "Fix"]);
  assert.equal(openPr.action, "open-pr");
  assert.equal(openPr.options.patchId, "pat_123");
  assert.equal(openPr.options.patchBranch, "repovista/fix");
  assert.equal(openPr.options.patchTitle, "Fix");
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
    "--incremental",
    "--label",
    "repovista",
    "--assignee",
    "octocat",
    "--update-existing"
  ]);

  assert.equal(parsed.options.auditProfile, "release-readiness");
  assert.equal(parsed.options.reviewMode, "deslopify");
  assert.equal(parsed.options.promptFile, "review.md");
  assert.equal(parsed.options.workspace, "packages/api");
  assert.equal(parsed.options.allWorkspaces, true);
  assert.equal(parsed.options.incremental, true);
  assert.deepEqual(parsed.options.issueLabels, ["repovista"]);
  assert.deepEqual(parsed.options.issueAssignees, ["octocat"]);
  assert.equal(parsed.options.issueUpdateExisting, true);
});

test("explicit no-run-checks wins over audit profile defaults", () => {
  const parsed = parseCliArgs(["audit", "--audit-profile", "pr-review", "--no-run-checks", "--no-parallel"]);
  const profiled = applyAuditProfile(parsed.options);

  assert.equal(profiled.runChecks, false);
  assert.equal(profiled.parallel, "off");
});
