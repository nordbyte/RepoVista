import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadStoredFindings,
  runNextFindingCommand,
  runRevalidateFindingCommand,
  runShowFindingCommand,
  runTriageFindingCommand,
  writeFindingState
} from "../dist/index.js";

test("finding lifecycle commands read, triage and revalidate persistent state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-finding-state-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const finding = {
      id: "fnd_fixture",
      source: "03-risk-and-bug-report.md",
      title: "Fixture finding",
      severity: "high",
      category: "reliability",
      status: "open",
      triage: "needs-fix",
      signature: "sig_fixture",
      paths: ["src/index.ts"],
      evidence: "src/index.ts exports value",
      evidenceReferences: ["src/index.ts"],
      recommendation: "Add validation.",
      confidence: "high"
    };

    const stateDir = await writeFindingState(root, ".repovista", [finding], "run-1", new Date("2026-05-18T10:00:00.000Z"));
    assert.match(stateDir, /\.repovista[/\\]findings$/);

    const next = await runNextFindingCommand({ outDir: ".repovista", findingStatus: "open" }, root);
    assert.match(next, /fnd_fixture/);
    assert.match(next, /Fixture finding/);

    const shown = await runShowFindingCommand({ outDir: ".repovista", findingId: "fnd_fixture" }, root);
    assert.match(shown, /History/);

    const triaged = await runTriageFindingCommand({
      outDir: ".repovista",
      findingId: "fnd_fixture",
      findingStatus: "false-positive",
      note: "not applicable in fixture"
    }, root, new Date("2026-05-18T11:00:00.000Z"));
    assert.match(triaged, /false-positive/);
    assert.equal((await loadStoredFindings(root, ".repovista"))[0].status, "false-positive");

    await runRevalidateFindingCommand({
      outDir: ".repovista",
      findingId: "fnd_fixture"
    }, root, new Date("2026-05-18T12:00:00.000Z"));
    const revalidated = (await loadStoredFindings(root, ".repovista"))[0];
    assert.equal(revalidated.status, "open");
    assert.equal(revalidated.evidenceValidation.passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
