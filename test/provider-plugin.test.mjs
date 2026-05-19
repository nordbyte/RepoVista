import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("provider plugins are loaded from JSON definitions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-provider-plugin-"));
  try {
    const pluginPath = path.join(root, "provider.json");
    await writeFile(pluginPath, JSON.stringify({
      id: "fixture-provider",
      displayName: "Fixture Provider",
      executable: "fixture-ai",
      outputMode: "stdout",
      args: ["run", "--cwd", "{projectRoot}", "--model", "{model}", "--out", "{reportPath}"]
    }), "utf8");

    const { stdout } = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      "import { getReportProvider, REPORT_PROVIDER_IDS } from './dist/index.js'; const p = getReportProvider('fixture-provider'); console.log(JSON.stringify({ ids: REPORT_PROVIDER_IDS, capabilities: p.capabilities, args: p.buildArgs({ projectRoot: '/repo', reportPath: '/tmp/report.md', phaseId: 'phase', phaseTitle: 'Phase', model: 'model-x', fastMode: false, sandbox: 'read-only', jsonEvents: false, keepLogs: false, timeoutSeconds: 1, provider: 'fixture-provider' }) }));"
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REPOVISTA_PROVIDER_PLUGIN: pluginPath
      }
    });

    const parsed = JSON.parse(stdout);
    assert.ok(parsed.ids.includes("fixture-provider"));
    assert.equal(parsed.capabilities.readOnlySandbox, true);
    assert.equal(parsed.capabilities.outputSchema, false);
    assert.deepEqual(parsed.args, ["run", "--cwd", "/repo", "--model", "model-x", "--out", "/tmp/report.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
