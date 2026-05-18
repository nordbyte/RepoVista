import test from "node:test";
import assert from "node:assert/strict";
import { createRunId } from "../dist/index.js";

test("run id is ISO-based and filesystem safe", () => {
  const runId = createRunId(new Date("2026-05-18T14:57:32.123Z"));

  assert.equal(runId, "2026-05-18T14-57-32-123Z");
  assert.equal(runId.includes(":"), false);
});
