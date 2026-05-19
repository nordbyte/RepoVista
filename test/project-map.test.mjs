import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OPTIONS, initializeProjectMap, loadFeatureRecords, loadProjectMap, renderProjectPlan } from "../dist/index.js";

test("project initialization writes a map with thread recommendations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-project-map-"));
  try {
    await mkdir(path.join(root, "src", "cli"), { recursive: true });
    await mkdir(path.join(root, "src", "providers"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      dependencies: { typescript: "^5.0.0" },
      devDependencies: { vitest: "^1.0.0" }
    }), "utf8");
    for (let index = 0; index < 320; index += 1) {
      const target = index % 3 === 0
        ? path.join(root, "src", "cli", `file-${index}.ts`)
        : index % 3 === 1
          ? path.join(root, "src", "providers", `file-${index}.ts`)
          : path.join(root, "test", `file-${index}.test.ts`);
      await writeFile(target, "export const value = 1;\n", "utf8");
    }

    const { map, mapPath } = await initializeProjectMap(root, DEFAULT_OPTIONS, new Date("2026-05-18T14:57:32.123Z"));
    const loaded = await loadProjectMap(root, ".repovista");
    const plan = renderProjectPlan(map, "auto");

    assert.equal(mapPath, path.join(root, ".repovista", "project-map.json"));
    assert.equal(loaded.map.fileCount, map.fileCount);
    assert.ok(map.recommendedParallelism >= 2);
    assert.ok(map.recommendedShards.length >= 2);
    assert.ok(map.features.length >= 2);
    assert.ok(map.features.some((feature) => feature.kind === "cli" || feature.kind === "integration" || feature.kind === "test-suite"));
    assert.ok(map.features.some((feature) => feature.source === "mapper"));
    assert.ok(map.features.some((feature) => feature.validationCommands?.length));
    const records = await loadFeatureRecords(root, ".repovista");
    assert.equal(records.length, map.features.length);
    assert.equal(records.every((feature) => feature.status === "pending"), true);
    assert.match(plan, /Thread assignments/);
    assert.match(plan, /Semantic features/);
    assert.ok(await readFile(mapPath, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project initialization rejects unsafe output directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-project-map-paths-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");

    await assert.rejects(
      () => initializeProjectMap(root, { ...DEFAULT_OPTIONS, outDir: "src/reports" }, new Date("2026-05-18T14:57:32.123Z")),
      /protected project path/i
    );
    await assert.rejects(
      () => initializeProjectMap(root, { ...DEFAULT_OPTIONS, outDir: "../reports" }, new Date("2026-05-18T14:57:32.123Z")),
      /inside the project root/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
