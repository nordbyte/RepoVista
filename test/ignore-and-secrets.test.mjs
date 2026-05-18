import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createIgnoreMatcher, maskObject, maskSensitiveText, matchesPattern } from "../dist/index.js";

test("default ignore rules exclude dependencies, build output, media and report folder", () => {
  const matcher = createIgnoreMatcher({
    projectRoot: process.cwd(),
    outDir: ".repovista",
    ignorePatterns: ["fixtures/**"]
  });

  assert.equal(matcher.shouldIgnore("node_modules/pkg/index.js", false), true);
  assert.equal(matcher.shouldIgnore("dist/index.js", false), true);
  assert.equal(matcher.shouldIgnore(".repovista/old/index.md", false), true);
  assert.equal(matcher.shouldIgnore("assets/logo.png", false), true);
  assert.equal(matcher.shouldIgnore("fixtures/demo.ts", false), true);
  assert.equal(matcher.shouldIgnore(path.join("src", "index.ts"), false), false);
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
});
