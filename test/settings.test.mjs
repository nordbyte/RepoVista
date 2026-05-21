import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applySettingsToDefaults,
  DEFAULT_OPTIONS,
  parseCodexConfigDefaults,
  parseCodexModelCatalog,
  reasoningOptionsForModel,
  renderSettingsMenuFrame,
  renderSettingsTerminalFrame,
  resolveCodexDefaultModel,
  sanitizeSettings,
  saveSettings,
  summarizeSettings
} from "../dist/index.js";

test("settings sanitize persisted defaults", () => {
  const sanitized = sanitizeSettings({
    provider: "claude",
    parallel: 3,
    model: " gpt-5.5 ",
    reasoning: " high ",
    fastMode: true,
    sandbox: "read-only",
    language: " English ",
    outDir: " .repovista ",
    includes: [" src/** ", "", "README.md"],
    ignores: [" dist/** ", "dist/**"],
    runChecks: true,
    checkCommands: [" npm test ", ""],
    checkTimeoutSeconds: 90.2,
    phaseTimeoutSeconds: 1800.6,
    strictReports: true,
    repairReports: true,
    repairAttempts: 2,
    deepReview: true,
    bugFindingsOnly: true,
    reviewMode: "deslopify",
    promptFile: " review.md ",
    exportFormats: ["sarif", "invalid", "html"],
    json: true,
    keepLogs: true,
    progress: false,
    ci: true,
    failOnCritical: true,
    // @ts-expect-error runtime validation test
    unknown: "ignored"
  });

  assert.deepEqual(sanitized, {
    provider: "claude",
    parallel: 3,
    model: "gpt-5.5",
    reasoning: "high",
    fastMode: true,
    sandbox: "read-only",
    language: "English",
    outDir: ".repovista",
    includes: ["src/**", "README.md"],
    ignores: ["dist/**"],
    runChecks: true,
    checkCommands: ["npm test"],
    checkTimeoutSeconds: 90,
    phaseTimeoutSeconds: 1801,
    strictReports: true,
    repairReports: true,
    repairAttempts: 2,
    deepReview: true,
    bugFindingsOnly: true,
    reviewMode: "deslopify",
    promptFile: "review.md",
    exportFormats: ["sarif", "html"],
    json: true,
    keepLogs: true,
    progress: false,
    ci: true,
    failOnCritical: true
  });
});

test("settings apply to audit defaults while preserving include and ignore arrays", () => {
  const options = applySettingsToDefaults(DEFAULT_OPTIONS, {
    provider: "claude",
    parallel: "auto",
    model: "gpt-5.5",
    reasoning: "xhigh",
    fastMode: true,
    language: "Spanish",
    keepLogs: true,
    includes: ["src/**"],
    ignores: ["fixtures/**"],
    runChecks: true,
    checkCommands: ["npm test"],
    strictReports: true,
    repairReports: true,
    deepReview: true,
    bugFindingsOnly: true,
    reviewMode: "security",
    promptFile: "review.md",
    exportFormats: ["sarif"]
  });

  assert.equal(options.provider, "claude");
  assert.equal(options.parallel, "auto");
  assert.equal(options.model, "gpt-5.5");
  assert.equal(options.reasoning, "xhigh");
  assert.equal(options.fastMode, true);
  assert.equal(options.language, "Spanish");
  assert.equal(options.keepLogs, true);
  assert.deepEqual(options.includes, ["src/**"]);
  assert.deepEqual(options.ignores, ["fixtures/**"]);
  assert.equal(options.runChecks, true);
  assert.deepEqual(options.checkCommands, ["npm test"]);
  assert.equal(options.strictReports, true);
  assert.equal(options.repairReports, true);
  assert.equal(options.deepReview, true);
  assert.equal(options.bugFindingsOnly, true);
  assert.equal(options.reviewMode, "security");
  assert.equal(options.promptFile, "review.md");
  assert.deepEqual(options.exportFormats, ["sarif"]);
});

test("settings preserve explicit empty arrays and clamp positive durations", () => {
  const sanitized = sanitizeSettings({
    includes: [],
    ignores: [],
    checkCommands: [],
    exportFormats: [],
    checkTimeoutSeconds: 0.2,
    phaseTimeoutSeconds: 0.4,
    repairAttempts: 0.6
  });

  assert.deepEqual(sanitized.includes, []);
  assert.deepEqual(sanitized.ignores, []);
  assert.deepEqual(sanitized.checkCommands, []);
  assert.deepEqual(sanitized.exportFormats, []);
  assert.equal(sanitized.checkTimeoutSeconds, 1);
  assert.equal(sanitized.phaseTimeoutSeconds, 1);
  assert.equal(sanitized.repairAttempts, 1);
});

test("settings are saved as JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-settings-"));
  try {
    const settingsPath = path.join(root, "settings.json");
    await saveSettings({ model: "gpt-5.5", fastMode: true }, settingsPath);
    const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(parsed.model, "gpt-5.5");
    assert.equal(parsed.fastMode, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("settings summary reflects built-in first-run defaults", () => {
  const summary = summarizeSettings({});

  assert.ok(summary.includes("Provider: Codex CLI"));
  assert.ok(summary.includes("Parallel mode: auto"));
  assert.ok(summary.includes("Audit profile: Default full audit"));
  assert.ok(summary.includes("Review mode: default (general risk and quality review)"));
  assert.ok(summary.includes("Bug findings only: off"));
  assert.ok(summary.includes("Reasoning: xhigh"));
  assert.ok(summary.includes("Incremental scan cache: on"));
  assert.ok(summary.includes("Run checks: on"));
  assert.ok(summary.includes("Strict report gates: on"));
  assert.ok(summary.includes("Repair reports: on"));
  assert.ok(summary.includes("Export formats: sarif, html, jsonl"));
});

test("settings menu frame renders only the menu with ANSI styling", () => {
  const frame = renderSettingsMenuFrame({
    provider: "codex",
    model: "gpt-5.5",
    reasoning: "xhigh",
    fastMode: true,
    runChecks: true
  }, { columns: 100, rows: 24, color: true });
  const plain = frame.replace(/\x1b\[[0-9;]*m/g, "");

  assert.match(frame, /(?:\x1b\[[0-9;]*m)+RepoVista Settings/);
  assert.match(plain, />  Provider: Codex CLI /);
  assert.match(plain, /Model: gpt-5\.5/);
  assert.match(plain, /Fast mode: on/);
  assert.match(plain, /Review mode: default \(general risk and quality review\)/);
  assert.match(plain, /\[ \] Bug findings only \(risk\/bug report for issues and PRs\)/);
  assert.equal(plain.match(/Provider: Codex CLI/g)?.length, 1);
  assert.equal(plain.match(/Reasoning: xhigh/g)?.length, 1);
  assert.ok(plain.indexOf("Reasoning: xhigh") < plain.indexOf("Fast mode: on"));
  assert.ok(plain.indexOf("Fast mode: on") < plain.indexOf("Codex profile: none"));
});

test("settings fast mode renders as on off selection", () => {
  const onFrame = renderSettingsMenuFrame({ fastMode: true }, { screen: "fastMode", columns: 80, rows: 12 });
  assert.match(onFrame, /Fast mode/);
  assert.match(onFrame, /\[x\] on \(request fast provider tier when supported\)/);
  assert.match(onFrame, /\[ \] off \(standard provider tier\)/);

  const offFrame = renderSettingsMenuFrame({ fastMode: false }, { screen: "fastMode", columns: 80, rows: 12 });
  assert.match(offFrame, /\[ \] on \(request fast provider tier when supported\)/);
  assert.match(offFrame, /\[x\] off \(standard provider tier\)/);
});

test("settings default selections are visible without persisted overrides", () => {
  const mainFrame = renderSettingsMenuFrame({}, { columns: 100, rows: 40 });
  assert.match(mainFrame, /Parallel mode: auto/);
  assert.match(mainFrame, /Audit profile: Default full audit/);
  assert.match(mainFrame, /Review mode: default \(general risk and quality review\)/);
  assert.match(mainFrame, /\[ \] Bug findings only \(risk\/bug report for issues and PRs\)/);
  assert.match(mainFrame, /Reasoning: xhigh/);
  assert.match(mainFrame, /\[x\] Incremental scan cache/);
  assert.match(mainFrame, /\[x\] Run local checks before analysis/);

  const parallelFrame = renderSettingsMenuFrame({}, { screen: "parallel", columns: 100, rows: 12 });
  assert.match(parallelFrame, /\[ \] off \(single provider session\)/);
  assert.match(parallelFrame, /\[x\] auto \(use RepoVista's project map recommendation\)/);

  const profileFrame = renderSettingsMenuFrame({}, { screen: "auditProfile", columns: 100, rows: 12 });
  assert.match(profileFrame, /\[x\] Full \(default\) - Standard complete audit without a profile/);
  assert.match(profileFrame, /\[ \] quick - Fast orientation pass/);

  const reviewFrame = renderSettingsMenuFrame({}, { screen: "reviewMode", columns: 100, rows: 12 });
  assert.match(reviewFrame, /\[x\] default \(general risk and quality review\)/);
  assert.match(reviewFrame, /\[ \] deslopify \(simplification and maintainability focus\)/);
  assert.match(reviewFrame, /\[ \] security \(security and abuse-case focus\)/);
  assert.match(reviewFrame, /\[ \] test-gaps \(missing test and regression focus\)/);

  const sandboxFrame = renderSettingsMenuFrame({}, { screen: "sandbox", columns: 100, rows: 12 });
  assert.match(sandboxFrame, /\[x\] read-only \(audit only, no file writes\)/);
  assert.match(sandboxFrame, /\[ \] workspace-write \(only for explicit fix workflows\)/);

  const exportFrame = renderSettingsMenuFrame({}, { screen: "exportFormats", columns: 80, rows: 12 });
  assert.match(exportFrame, /\[x\] sarif \(security tooling\)/);
  assert.match(exportFrame, /\[x\] html \(browser dashboard\)/);
  assert.match(exportFrame, /\[x\] jsonl \(line-oriented findings\)/);
  assert.match(exportFrame, /\[ \] github \(GitHub annotations\)/);
});

test("settings terminal frame clears every line ending", () => {
  const frame = [
    "\x1b[46m Active line \x1b[0m",
    "Short"
  ].join("\n");
  const terminalFrame = renderSettingsTerminalFrame(frame);

  assert.match(terminalFrame, /^\x1b\[H/);
  assert.match(terminalFrame, /\x1b\[K\nShort\x1b\[K\x1b\[J$/);
});

test("codex model catalog parsing exposes current model and reasoning options", () => {
  const models = parseCodexModelCatalog(JSON.stringify({
    models: [
      {
        slug: "gpt-5.5",
        display_name: "GPT-5.5",
        default_reasoning_level: "medium",
        supported_reasoning_levels: [
          { effort: "low", description: "fast" },
          { effort: "high", description: "deep" }
        ],
        additional_speed_tiers: ["fast"],
        service_tiers: [{ id: "fast" }]
      }
    ]
  }));

  assert.equal(models[0].slug, "gpt-5.5");
  assert.equal(models[0].supportsFastMode, true);
  assert.deepEqual(reasoningOptionsForModel(models, "gpt-5.5").map((item) => item.effort), ["low", "high"]);
});

test("codex config default parsing reads top-level model settings", () => {
  const defaults = parseCodexConfigDefaults([
    "# global defaults",
    "model = \"gpt-5.5\"",
    "model_reasoning_effort = \"xhigh\" # comment",
    "",
    "[profiles.fast]",
    "model = \"gpt-5.4-mini\"",
    "model_reasoning_effort = \"low\"",
    "",
    "[profiles.\"deep-review\"]",
    "model = \"gpt-5.5\""
  ].join("\n"));

  assert.deepEqual(defaults, {
    model: "gpt-5.5",
    reasoning: "xhigh",
    profiles: {
      fast: {
        model: "gpt-5.4-mini",
        reasoning: "low"
      },
      "deep-review": {
        model: "gpt-5.5"
      }
    }
  });
});

test("codex default model resolver honors selected profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-config-"));
  try {
    const configPath = path.join(root, "config.toml");
    await writeFile(configPath, [
      "model = \"gpt-5.5\"",
      "",
      "[profiles.audit]",
      "model = \"gpt-5.4\""
    ].join("\n"), "utf8");

    assert.equal(await resolveCodexDefaultModel(configPath, "audit"), "gpt-5.4");
    assert.equal(await resolveCodexDefaultModel(configPath, "missing"), "gpt-5.5");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
