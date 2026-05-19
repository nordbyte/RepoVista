import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createIgnoreMatcher, createSensitiveTextMasker, maskObject, maskSensitiveText, matchesPattern, scanProject } from "../dist/index.js";

test("default ignore rules exclude dependencies, build output, media and report folder", () => {
  const matcher = createIgnoreMatcher({
    projectRoot: process.cwd(),
    outDir: ".repovista",
    ignorePatterns: ["fixtures/**"]
  });

  assert.equal(matcher.shouldIgnore("node_modules/pkg/index.js", false), true);
  assert.equal(matcher.shouldIgnore("dist/index.js", false), true);
  assert.equal(matcher.shouldIgnore(".repovista/old/index.md", false), true);
  assert.equal(matcher.shouldIgnore(".nordrelay/state.json", false), true);
  assert.equal(matcher.shouldIgnore("assets/logo.png", false), true);
  assert.equal(matcher.shouldIgnore("fixtures/demo.ts", false), true);
  assert.equal(matcher.shouldIgnore(path.join("src", "index.ts"), false), false);
});

test("project scan respects repository ignore files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-ignore-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, ".gitignore"), "local-state/\n.nordrelay/\n", "utf8");
    await writeFile(path.join(root, "visible.ts"), "export const visible = true;\n", "utf8");
    await writeFile(path.join(root, "local-state"), "not a directory yet\n", "utf8");
    const scan = await scanProject(root, { outDir: ".repovista", includes: [], ignores: [] });
    assert.equal(scan.files.some((file) => file.relativePath === "visible.ts"), true);
    assert.equal(scan.files.some((file) => file.relativePath === "local-state"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("glob matcher supports nested patterns", () => {
  assert.equal(matchesPattern("src/app/index.ts", "src/**/*.ts"), true);
  assert.equal(matchesPattern("src/app/index.ts", "*.ts"), true);
  assert.equal(matchesPattern("src/app/index.ts", "test/**"), false);
});

test("secret masking redacts sensitive object keys and env assignments", () => {
  const masked = maskObject({
    apiKey: "abc123",
    script: "TOKEN=abc node deploy.js",
    nested: {
      password: "secret"
    }
  });

  assert.equal(masked.apiKey, "[masked]");
  assert.equal(masked.script, "TOKEN=[masked] node deploy.js");
  assert.deepEqual(masked.nested, { password: "[masked]" });
  assert.equal(maskSensitiveText("https://user:pass@example.com"), "https://[masked]@example.com");
  assert.equal(maskSensitiveText("Authorization: Bearer ghp_123456789012345678901234"), "Authorization: [masked]");
  assert.equal(maskSensitiveText('{"apiKey":"sk-123456789012345678901234"}'), '{"apiKey":"[masked]"}');
});

test("streaming secret masker catches secrets split across chunks", () => {
  const masker = createSensitiveTextMasker(64);
  const output = [
    masker.push("TOKEN=s3"),
    masker.push("cr3t-value\n"),
    masker.flush()
  ].join("");

  assert.doesNotMatch(output, /s3cr3t/);
  assert.match(output, /\[masked\]/);
});
