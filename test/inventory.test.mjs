import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProjectInventory } from "../dist/index.js";

test("inventory summarizes a mock project without old reports or secret values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-inventory-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, ".repovista", "old"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          build: "tsc -p tsconfig.json",
          test: "vitest",
          deploy: "TOKEN=secret node deploy.js"
        },
        dependencies: {
          react: "^19.0.0",
          express: "^5.0.0"
        },
        devDependencies: {
          typescript: "^5.7.3",
          vitest: "^3.0.0"
        }
      }),
      "utf8"
    );
    await writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n", "utf8");
    await writeFile(path.join(root, ".repovista", "old", "index.md"), "old report\n", "utf8");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = {}\n", "utf8");

    const inventory = await createProjectInventory(root, {
      outDir: ".repovista",
      includes: [],
      ignores: [],
      now: new Date("2026-05-18T14:57:32.123Z")
    });

    assert.equal(inventory.languages.TypeScript, 1);
    assert.ok(inventory.frameworks.includes("React"));
    assert.ok(inventory.frameworks.includes("Express"));
    assert.match(inventory.markdown, /TOKEN=\[masked\]/);
    assert.doesNotMatch(inventory.markdown, /old report/);
    assert.doesNotMatch(inventory.markdown, /node_modules\/pkg/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
