import test from "node:test";
import assert from "node:assert/strict";
import { commandAvailable, runProcess } from "../dist/index.js";

test("shared process runner captures and masks output", async () => {
  const result = await runProcess(process.execPath, [
    "-e",
    "console.log('API_KEY=super-secret-value')"
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /API_KEY=\[masked\]/);
  assert.doesNotMatch(result.stdout, /super-secret-value/);
});

test("shared process runner reports timeouts", async () => {
  const result = await runProcess(process.execPath, [
    "-e",
    "setInterval(() => {}, 1000)"
  ], { timeoutMs: 50 });

  assert.equal(result.timedOut, true);
  assert.match(result.error ?? "", /timed out/i);
});

test("commandAvailable uses the shared process runner", async () => {
  assert.equal(await commandAvailable(process.execPath, ["--version"]), true);
  assert.equal(await commandAvailable("repovista-missing-command-for-test", ["--version"], 50), false);
});
