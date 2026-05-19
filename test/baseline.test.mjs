import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyBaselineToFindings, runBaselineCommand, writeFindingState } from "../dist/index.js";

test("baseline command adds suppressions and filters findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-baseline-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    const finding = {
      id: "fnd_123",
      source: "03-risk-and-bug-report.md",
      title: "Accepted issue",
      severity: "high",
      signature: "sig-123",
      paths: ["src/index.ts"]
    };
    await writeFindingState(root, ".repovista", [finding], "run-1", new Date("2026-05-18T10:00:00.000Z"));

    const output = await runBaselineCommand({
      outDir: ".repovista",
      baselineAction: "add",
      findingId: "fnd_123",
      note: "accepted risk"
    }, root, new Date("2026-05-18T11:00:00.000Z"));

    assert.match(output, /Added RepoVista baseline suppression/);
    const baseline = JSON.parse(await readFile(path.join(root, ".repovista", "baseline.json"), "utf8"));
    assert.equal(baseline.suppressions[0].signature, "sig-123");

    const result = await applyBaselineToFindings(root, ".repovista", [finding], "run-2", new Date("2026-05-18T12:00:00.000Z"));
    assert.equal(result.activeFindings.length, 0);
    assert.equal(result.suppressedFindings.length, 1);
    assert.equal(result.suppressedFindings[0].triage, "suppressed-by-baseline");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseline command rejects malformed baseline state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-baseline-bad-"));
  try {
    await mkdir(path.join(root, ".repovista"), { recursive: true });
    await writeFile(path.join(root, ".repovista", "baseline.json"), "{not-json", "utf8");

    await assert.rejects(
      () => runBaselineCommand({ outDir: ".repovista", baselineAction: "list" }, root),
      /baseline file/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
