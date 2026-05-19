import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applySettingsToDefaults,
  DEFAULT_OPTIONS,
  parseCodexModelCatalog,
  reasoningOptionsForModel,
  renderSettingsMenuFrame,
  sanitizeSettings,
  saveSettings
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

test("settings menu frame renders only the menu with ANSI styling", () => {
  const frame = renderSettingsMenuFrame({
    provider: "codex",
    model: "gpt-5.5",
    reasoning: "xhigh",
    runChecks: true
  }, { columns: 100, rows: 24, color: true });
  const plain = frame.replace(/\x1b\[[0-9;]*m/g, "");

  assert.match(frame, /(?:\x1b\[[0-9;]*m)+RepoVista Settings/);
  assert.match(plain, />  Provider: Codex CLI /);
  assert.match(plain, /Model: gpt-5\.5/);
  assert.equal(plain.match(/Provider: Codex CLI/g)?.length, 1);
  assert.equal(plain.match(/Reasoning: xhigh/g)?.length, 1);
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
