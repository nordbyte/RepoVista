import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateAuditCache } from "../dist/index.js";

test("audit cache records fine-grained phase feature and shard reuse hits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-cache-"));
  try {
    const common = {
      projectRoot: root,
      outDir: ".repovista",
      reuseKey: "reuse",
      promptManifestFingerprint: "prompt",
      providerVersion: "provider-1",
      promptContextVersion: 1,
      phaseSchemaVersion: 1,
      qualityGateVersion: 1,
      fileCount: 2,
      enabled: true
    };
    await updateAuditCache({
      ...common,
      runDir: path.join(root, ".repovista", "old"),
      runId: "old",
      scanFingerprint: "scan-old",
      phaseFingerprints: [{ phaseId: "risk-and-bug", reportFile: "03-risk-and-bug-report.md", fingerprint: "phase-a" }],
      featureFingerprints: [{ featureId: "feature-a", fingerprint: "feature-a" }],
      shardFingerprints: [{ phaseId: "risk-and-bug", shardId: "thread-1", reportFile: "shards/risk-and-bug/thread-1.md", fingerprint: "shard-a" }],
      now: new Date("2026-05-20T10:00:00.000Z")
    });

    const meta = await updateAuditCache({
      ...common,
      runDir: path.join(root, ".repovista", "new"),
      runId: "new",
      scanFingerprint: "scan-new",
      phaseFingerprints: [{ phaseId: "risk-and-bug", reportFile: "03-risk-and-bug-report.md", fingerprint: "phase-a" }],
      featureFingerprints: [{ featureId: "feature-a", fingerprint: "feature-a" }],
      shardFingerprints: [{ phaseId: "risk-and-bug", shardId: "thread-1", reportFile: "shards/risk-and-bug/thread-1.md", fingerprint: "shard-a" }],
      now: new Date("2026-05-20T10:01:00.000Z")
    });

    assert.equal(meta.hit, false);
    assert.equal(meta.phaseReuse[0].hit, true);
    assert.equal(meta.phaseReuse[0].previousRunId, "old");
    assert.equal(meta.featureReuse[0].hit, true);
    assert.equal(meta.shardReuse[0].hit, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
