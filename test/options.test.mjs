import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, validateSandbox } from "../dist/index.js";

test("default command runs audit with safe defaults", () => {
  const parsed = parseCliArgs([]);

  assert.equal(parsed.action, "audit");
  assert.equal(parsed.options.outDir, ".repovista");
  assert.equal(parsed.options.sandbox, "read-only");
  assert.equal(parsed.options.language, "English");
  assert.equal(parsed.options.fastMode, false);
  assert.equal(parsed.options.progress, true);
});

test("explicit audit command parses supported options", () => {
  const parsed = parseCliArgs([
    "audit",
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
    "--ci",
    "--fail-on-critical",
    "--keep-logs"
  ]);

  assert.equal(parsed.action, "audit");
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

test("settings command is recognized", () => {
  const parsed = parseCliArgs(["settings"]);
  assert.equal(parsed.action, "settings");
});
