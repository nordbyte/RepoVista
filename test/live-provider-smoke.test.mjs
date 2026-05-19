import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OPTIONS, runProvidersCommand } from "../dist/index.js";

const enabled = process.env.REPOVISTA_LIVE_PROVIDER_TESTS === "1";
const providers = (process.env.REPOVISTA_LIVE_PROVIDER_IDS ?? "codex,claude,gemini,opencode,aider")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

test("optional live provider smoke tests", { skip: enabled ? false : "Set REPOVISTA_LIVE_PROVIDER_TESTS=1 to run live provider checks." }, async () => {
  for (const provider of providers) {
    const output = await runProvidersCommand({
      ...DEFAULT_OPTIONS,
      provider,
      providerAction: "test",
      json: true
    });
    const parsed = JSON.parse(output);
    assert.equal(parsed.provider, provider);
    assert.equal(parsed.available, true, parsed.error);
  }
});
