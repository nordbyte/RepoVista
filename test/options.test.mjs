import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, validateSandbox } from "../dist/index.js";

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
