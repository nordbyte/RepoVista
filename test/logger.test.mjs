import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../dist/logger.js";

test("progress heartbeat labels provider stream output as diagnostics", () => {
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, ...args) => {
    writes.push(String(chunk));
    const callback = args.find((arg) => typeof arg === "function");
    callback?.();
    return true;
  };
  try {
    const logger = new Logger(true);
    logger.providerEvent({
      providerId: "architecture",
      parentPhaseId: "architecture",
      type: "spawned",
      at: "2026-05-21T13:49:00.000Z",
      pid: 123
    });
    logger.providerEvent({
      providerId: "architecture",
      parentPhaseId: "architecture",
      type: "output",
      at: "2026-05-21T13:50:01.000Z",
      stream: "stderr",
      bytes: 2048
    });

    const output = writes.join("");
    assert.match(output, /provider diagnostics \(stderr\)/);
    assert.doesNotMatch(output, /provider output on stderr/);
  } finally {
    process.stderr.write = originalWrite;
  }
});
