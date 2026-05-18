import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, extractStructuredPhaseReport, validateReportQuality } from "../dist/index.js";

test("golden roadmap fixture satisfies structured quality gates", async () => {
  const markdown = await readFile(new URL("./fixtures/golden-roadmap.md", import.meta.url), "utf8");
  const structured = extractStructuredPhaseReport(markdown, "feature-roadmap", "golden-roadmap.md");
  const quality = validateReportQuality("feature-roadmap", markdown);

  assert.equal(structured.phaseId, "feature-roadmap");
  assert.equal(structured.proposals.length, 6);
  assert.equal(quality.passed, true);
  assert.equal(quality.warnings.length, 0);
});

test("new CLI flows parse noninteractive settings, exports, repair and PR mode", () => {
  const settingsSet = parseCliArgs(["settings", "set", "model", "gpt-5.5"]);
  assert.equal(settingsSet.action, "settings-set");
  assert.equal(settingsSet.options.settingsKey, "model");
  assert.equal(settingsSet.options.settingsValue, "gpt-5.5");

  assert.equal(parseCliArgs(["settings", "get", "model"]).action, "settings-get");
  assert.equal(parseCliArgs(["settings", "reset", "model"]).action, "settings-reset");

  const audit = parseCliArgs(["audit", "--pr", "--base", "main", "--repair-reports", "--repair-attempts", "2", "--export", "sarif,html,jsonl,github"]);
  assert.equal(audit.options.prMode, true);
  assert.equal(audit.options.since, "main");
  assert.equal(audit.options.baseRef, "main");
  assert.equal(audit.options.repairReports, true);
  assert.equal(audit.options.repairAttempts, 2);
  assert.deepEqual(audit.options.exportFormats, ["sarif", "html", "jsonl", "github"]);

  const findings = parseCliArgs(["findings", "--json", "--export", "sarif"]);
  assert.equal(findings.action, "findings");
  assert.deepEqual(findings.options.exportFormats, ["sarif"]);
});
