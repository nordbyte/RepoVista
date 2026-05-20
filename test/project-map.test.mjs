import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OPTIONS, checkProjectMapFreshness, initializeProjectMap, loadFeatureRecords, loadProjectMap, renderProjectPlan, runPlanCommand } from "../dist/index.js";

test("project initialization writes a map with provider-session recommendations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-project-map-"));
  try {
    await mkdir(path.join(root, "src", "cli"), { recursive: true });
    await mkdir(path.join(root, "src", "providers"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "src", "settings-menu.ts"), "export const settings = true;\n", "utf8");
    await writeFile(path.join(root, "src", "report-review.ts"), "export const reports = true;\n", "utf8");
    await writeFile(path.join(root, "src", "state-store.ts"), "export const state = true;\n", "utf8");
    await writeFile(path.join(root, "src", "secrets.ts"), "export const security = true;\n", "utf8");
    await writeFile(path.join(root, "src", "ci-init.ts"), "export const ci = true;\n", "utf8");
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
    assert.ok(map.features.some((feature) => feature.kind === "provider"));
    assert.ok(map.features.some((feature) => feature.kind === "reporting"));
    assert.ok(map.features.some((feature) => feature.kind === "state"));
    assert.ok(map.features.some((feature) => feature.kind === "settings"));
    assert.ok(map.features.some((feature) => feature.kind === "security"));
    assert.ok(map.areas.some((area) => area.id === "src/providers"));
    assert.ok(map.areas.some((area) => area.id === "src/reports"));
    assert.ok(map.areas.some((area) => area.id === "src/state"));
    assert.ok(map.features.some((feature) => feature.source === "mapper"));
    assert.ok(map.features.some((feature) => feature.validationCommands?.length));
    const records = await loadFeatureRecords(root, ".repovista");
    assert.equal(records.length, map.features.length);
    assert.equal(records.every((feature) => feature.status === "pending"), true);
    assert.match(plan, /Provider-session assignments/);
    assert.match(plan, /Semantic features/);
    assert.ok(await readFile(mapPath, "utf8"));

    const fresh = await checkProjectMapFreshness(root, DEFAULT_OPTIONS, map);
    assert.equal(fresh.stale, false);
    await writeFile(path.join(root, "src", "cli", "new-file.ts"), "export const newer = 1;\n", "utf8");
    const stale = await checkProjectMapFreshness(root, DEFAULT_OPTIONS, map);
    assert.equal(stale.stale, true);
    assert.match((await runPlanCommand(DEFAULT_OPTIONS, root)), /project map appears stale/i);
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

test("workspace map v2 expands globstar workspaces and records scripts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-workspace-map-"));
  try {
    await mkdir(path.join(root, "packages", "backend", "api", "src"), { recursive: true });
    await mkdir(path.join(root, "packages", "backend", "ignored", "src"), { recursive: true });
    await mkdir(path.join(root, "apps", "web", "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      workspaces: ["packages/**", "apps/*", "!packages/**/ignored"]
    }), "utf8");
    await writeFile(path.join(root, "packages", "backend", "api", "package.json"), JSON.stringify({
      name: "@fixture/api",
      scripts: {
        test: "node --test",
        build: "tsc -p tsconfig.json"
      },
      dependencies: {
        express: "^5.0.0"
      }
    }), "utf8");
    await writeFile(path.join(root, "packages", "backend", "api", "src", "index.ts"), "export const api = true;\n", "utf8");
    await writeFile(path.join(root, "packages", "backend", "ignored", "package.json"), JSON.stringify({
      name: "@fixture/ignored"
    }), "utf8");
    await writeFile(path.join(root, "packages", "backend", "ignored", "src", "index.ts"), "export const ignored = true;\n", "utf8");
    await writeFile(path.join(root, "apps", "web", "package.json"), JSON.stringify({
      name: "@fixture/web",
      scripts: {
        lint: "eslint ."
      },
      devDependencies: {
        vite: "^6.0.0"
      }
    }), "utf8");
    await writeFile(path.join(root, "apps", "web", "src", "index.ts"), "export const web = true;\n", "utf8");
    for (let index = 0; index < 260; index += 1) {
      const target = index % 2 === 0
        ? path.join(root, "packages", "backend", "api", "src", `api-${index}.ts`)
        : path.join(root, "apps", "web", "src", `web-${index}.ts`);
      await writeFile(target, "export const value = true;\n", "utf8");
    }

    const { map } = await initializeProjectMap(root, DEFAULT_OPTIONS, new Date("2026-05-18T14:57:32.123Z"));
    const workspacePaths = map.workspaces.map((workspace) => workspace.path).sort();

    assert.deepEqual(workspacePaths, ["apps/web", "packages/backend/api"]);
    assert.ok(map.workspaces.find((workspace) => workspace.name === "@fixture/api").dependencies.includes("express"));
    assert.ok(map.workspaces.find((workspace) => workspace.name === "@fixture/api").validationCommands.includes("npm run test"));
    assert.ok(map.recommendedShards.some((shard) => shard.workspace === "apps/web" || shard.workspace === "packages/backend/api"));
    assert.match(renderProjectPlan(map), /Workspaces/);
    assert.match(renderProjectPlan(map), /@fixture\/api/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
