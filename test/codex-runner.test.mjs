import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildClaudeExecArgs,
  buildCodexExecArgs,
  fixPlanJsonSchema,
  phaseReportJsonSchema,
  publishFindingJsonSchema,
  revalidationJsonSchema,
  renderStructuredProviderOutput,
  riskReportJsonSchema,
  structuredPromptForPhase,
  extractProviderUsageTelemetry,
  runCodexPhase,
  runProviderPhase
} from "../dist/index.js";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
}

test("provider telemetry extracts token and cost usage from provider output", () => {
  const telemetry = extractProviderUsageTelemetry(
    '{"usage":{"input_tokens":1234,"output_tokens":56,"total_tokens":1290},"cost_usd":0.042}\n',
    ""
  );
  assert.equal(telemetry.source, "stdout");
  assert.equal(telemetry.inputTokens, 1234);
  assert.equal(telemetry.outputTokens, 56);
  assert.equal(telemetry.totalTokens, 1290);
  assert.equal(telemetry.costUsd, 0.042);
});

function assertAllObjectPropertiesRequired(schema, label = "schema") {
  if (!schema || typeof schema !== "object") {
    return;
  }
  if (schema.type === "object" && schema.properties) {
    assert.equal(schema.additionalProperties, false, `${label} must reject additional properties`);
    const properties = Object.keys(schema.properties).sort();
    assert.deepEqual([...(schema.required ?? [])].sort(), properties, `${label} required keys must match properties`);
    for (const [key, value] of Object.entries(schema.properties)) {
      assertAllObjectPropertiesRequired(value, `${label}.${key}`);
    }
  }
  if (schema.type === "array" && schema.items) {
    assertAllObjectPropertiesRequired(schema.items, `${label}[]`);
  }
  if (schema.type === "array") {
    assert.ok(schema.items, `${label} arrays must declare items`);
  }
}

test("codex provider-native schemas satisfy strict structured-output requirements", () => {
  for (const [label, schema] of Object.entries({
    phaseReportJsonSchema,
    riskReportJsonSchema,
    fixPlanJsonSchema,
    revalidationJsonSchema,
    publishFindingJsonSchema
  })) {
    assertAllObjectPropertiesRequired(schema, label);
  }
});

test("codex args use read-only sandbox, target cwd and output-last-message", () => {
  const args = buildCodexExecArgs({
    phaseId: "architecture",
    phaseTitle: "Architecture",
    prompt: "prompt",
    projectRoot: "/repo",
    reportPath: "/repo/.repovista/run/report.md",
    sandbox: "read-only",
    jsonEvents: true,
    keepLogs: false,
    model: "gpt-5.5",
    profile: "default",
    reasoning: "high",
    fastMode: true
  });

  assert.deepEqual(args.slice(0, 2), ["exec", "--cd"]);
  assert.ok(args.includes("/repo"));
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("--config"));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--skip-git-repo-check"));
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--output-last-message"));
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("--profile"));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('service_tier="fast"'));
});

test("claude args use print mode, model, effort and non-persistent sessions", () => {
  const args = buildClaudeExecArgs({
    provider: "claude",
    phaseId: "architecture",
    phaseTitle: "Architecture",
    prompt: "prompt",
    projectRoot: "/repo",
    reportPath: "/repo/.repovista/run/report.md",
    sandbox: "read-only",
    jsonEvents: false,
    keepLogs: false,
    model: "sonnet",
    reasoning: "max",
    fastMode: false,
    timeoutSeconds: 60
  });

  assert.ok(args.includes("--print"));
  assert.ok(args.includes("--output-format"));
  assert.ok(args.includes("text"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(args.includes("--permission-mode"));
  assert.ok(args.includes("plan"));
  assert.ok(args.includes("--add-dir"));
  assert.ok(args.includes("/repo"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("sonnet"));
  assert.ok(args.includes("--effort"));
  assert.ok(args.includes("max"));
});

test("codex runner writes success report via mocked process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-"));
  try {
    const reportPath = path.join(root, "report.md");
    const logsDir = path.join(root, "logs");
    const child = new FakeChild();
    const spawnAdapter = (_command, args, options) => {
      assert.equal(options.cwd, root);
      assert.ok(args.includes("--output-last-message"));
      setImmediate(async () => {
        await writeFile(reportPath, "# Report\n\nOK\n", "utf8");
        child.stdout.write("{\"event\":\"done\"}\n");
        child.stderr.write("technical\n");
        child.emit("close", 0);
      });
      return child;
    };

    const result = await runCodexPhase({
      phaseId: "architecture",
      phaseTitle: "Architecture",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      logsDir,
      sandbox: "read-only",
      jsonEvents: true,
      keepLogs: false
    }, spawnAdapter);

    assert.equal(result.success, true);
    assert.equal(await readFile(reportPath, "utf8"), "# Report\n\nOK\n");
    assert.equal(result.stdoutLogPath, path.join(logsDir, "architecture.stdout.jsonl"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider runner writes claude stdout as the final report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-claude-"));
  try {
    const reportPath = path.join(root, "report.md");
    const child = new FakeChild();
    const spawnAdapter = (command, args, options) => {
      assert.equal(command, "claude");
      assert.equal(options.cwd, root);
      assert.ok(args.includes("--print"));
      setImmediate(() => {
        child.stdout.write("# Claude Report\n\nOK\n");
        child.emit("close", 0);
      });
      return child;
    };

    const result = await runProviderPhase({
      provider: "claude",
      phaseId: "architecture",
      phaseTitle: "Architecture",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: false,
      fastMode: false,
      timeoutSeconds: 60
    }, spawnAdapter);

    assert.equal(result.success, true);
    assert.equal(await readFile(reportPath, "utf8"), "# Claude Report\n\nOK\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex provider-native schema output is rendered into markdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-schema-"));
  try {
    const reportPath = path.join(root, "risk.md");
    const child = new FakeChild();
    const spawnAdapter = (_command, args, options) => {
      assert.equal(options.cwd, root);
      assert.ok(args.includes("--output-schema"));
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      setImmediate(async () => {
        await writeFile(outputPath, JSON.stringify({
          schemaVersion: 1,
          phaseId: "risk-and-bug",
          executiveSummary: "One issue.",
          severitySummary: {
            critical: "No critical findings.",
            high: "One high finding.",
            medium: "No medium findings.",
            low: "No low findings."
          },
          findings: [
            {
              title: "Missing guard",
              severity: "high",
              category: "reliability",
              status: "open",
              signature: "high|reliability|src/index.ts|guard",
              affectedPaths: ["src/index.ts"],
              evidence: "src/index.ts lacks a guard",
              evidenceReferences: [{ path: "src/index.ts", startLine: 1, endLine: 1, quote: "export", symbol: null }],
              problemRationale: "The guard is missing.",
              recommendedFix: "Add the guard.",
              reproduction: "Inspect src/index.ts.",
              suggestedRegressionTest: "Add a guard test.",
              minimumFixScope: "src/index.ts",
              estimatedEffort: "small",
              confidence: "high",
              findingType: "atomic",
              parentId: null,
              parentTitle: null,
              childFindings: []
            }
          ],
          recommendations: ["Add the guard."],
          inspected: { files: ["src/index.ts"], symbols: [], notes: [] }
        }), "utf8");
        child.emit("close", 0);
      });
      return child;
    };

    const result = await runProviderPhase({
      provider: "codex",
      phaseId: "risk-and-bug",
      phaseTitle: "Risk",
      prompt: "return json",
      projectRoot: root,
      reportPath,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: false,
      fastMode: false,
      timeoutSeconds: 60,
      outputSchema: riskReportJsonSchema,
      outputSchemaKind: "risk-report"
    }, spawnAdapter);

    const report = await readFile(reportPath, "utf8");
    assert.equal(result.success, true);
    assert.match(report, /Risk and Bug Analysis/);
    assert.match(report, /Missing guard/);
    assert.match(report, /repovista-findings:start/);
    assert.match(report, /"affectedPaths": \[\s*"src\/index\.ts"\s*\]/);
    assert.match(report, /"recommendedFix": "Add the guard\."/);
    assert.doesNotMatch(report, /"paths": \[/);
    assert.ok(result.structuredOutputPath.endsWith(".structured.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("risk report renderer separates findings with a blank line", () => {
  const report = renderStructuredProviderOutput("risk-report", JSON.stringify({
    schemaVersion: 1,
    phaseId: "risk-and-bug",
    executiveSummary: "Two issues.",
    severitySummary: {
      critical: "No critical findings.",
      high: "Two high findings.",
      medium: "No medium findings.",
      low: "No low findings."
    },
    findings: [
      riskFindingFixture("Missing guard", "high|missing-guard"),
      riskFindingFixture("Missing timeout", "high|missing-timeout")
    ],
    recommendations: ["Fix both risks."],
    inspected: { files: ["src/index.ts"], symbols: [], notes: [] }
  }));

  assert.match(report, /- Title: Missing guard[\s\S]*  Confidence: high\n\n- Title: Missing timeout/);
});

test("risk structured prompt requires exact evidence quotes", () => {
  const prompt = structuredPromptForPhase("risk-and-bug", "Base prompt");
  assert.match(prompt, /Every evidenceReferences item with a quote must use text copied exactly/);
  assert.match(prompt, /if an exact substring is uncertain, omit quote/);
  assert.match(prompt, /direct substring/);
});

test("codex runner creates an error report on failed process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-fail-"));
  try {
    const reportPath = path.join(root, "report.md");
    const child = new FakeChild();
    const spawnAdapter = () => {
      setImmediate(() => {
        child.stderr.write("not authenticated\n");
        child.emit("close", 1);
      });
      return child;
    };

    const result = await runCodexPhase({
      phaseId: "risk",
      phaseTitle: "Risk",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: false
    }, spawnAdapter);

    assert.equal(result.success, false);
    assert.match(await readFile(reportPath, "utf8"), /Failed/);
    assert.match(result.error, /unauthenticated/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider runner masks sensitive failure output and logs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-provider-mask-"));
  try {
    const reportPath = path.join(root, "report.md");
    const logsDir = path.join(root, "logs");
    const child = new FakeChild();
    const spawnAdapter = () => {
      setImmediate(() => {
        child.stdout.write("TOKEN=s3");
        child.stdout.write("cr3t-value\n");
        child.stderr.write("request failed for https://user:pass@example.com with API_KEY=abc123\n");
        child.emit("close", 1);
      });
      return child;
    };

    const result = await runProviderPhase({
      provider: "codex",
      phaseId: "risk",
      phaseTitle: "Risk",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      logsDir,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: true,
      timeoutSeconds: 60
    }, spawnAdapter);

    const report = await readFile(reportPath, "utf8");
    const stdoutLog = await readFile(result.stdoutLogPath, "utf8");
    const stderrLog = await readFile(result.stderrLogPath, "utf8");

    assert.equal(result.success, false);
    assert.doesNotMatch(report, /s3cr3t-value|user:pass|abc123/);
    assert.doesNotMatch(stdoutLog, /s3cr3t-value/);
    assert.doesNotMatch(stderrLog, /user:pass|abc123/);
    assert.match(report, /\[masked\]/);
    assert.match(stdoutLog, /\[masked\]/);
    assert.match(stderrLog, /\[masked\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex runner cancels a phase after timeout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-timeout-"));
  try {
    const reportPath = path.join(root, "report.md");
    const child = new FakeChild();
    child.pid = 99999999;
    const signals = [];
    child.kill = (signal) => {
      signals.push(signal);
      setImmediate(() => child.emit("close", null, signal));
      return true;
    };
    const result = await runCodexPhase({
      phaseId: "architecture",
      phaseTitle: "Architecture",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: false,
      timeoutSeconds: 0.01
    }, (_command, _args, options) => {
      assert.equal(options.detached, process.platform !== "win32");
      return child;
    });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out/);
    assert.equal(result.diagnostics.timedOut, true);
    assert.equal(result.diagnostics.pid, 99999999);
    assert.equal(result.diagnostics.termination.sigtermSent, true);
    assert.deepEqual(signals, ["SIGTERM"]);
    assert.match(await readFile(reportPath, "utf8"), /timed out/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider runner cancels a phase when the audit abort signal fires", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-codex-abort-"));
  try {
    const reportPath = path.join(root, "report.md");
    const child = new FakeChild();
    const controller = new AbortController();
    child.pid = 99999998;
    const signals = [];
    child.kill = (signal) => {
      signals.push(signal);
      setImmediate(() => child.emit("close", null, signal));
      return true;
    };
    const result = await runProviderPhase({
      provider: "codex",
      phaseId: "architecture",
      phaseTitle: "Architecture",
      prompt: "prompt",
      projectRoot: root,
      reportPath,
      sandbox: "read-only",
      jsonEvents: false,
      keepLogs: false,
      timeoutSeconds: 60,
      abortSignal: controller.signal
    }, () => {
      setImmediate(() => controller.abort(new Error("test cancellation")));
      return child;
    });

    assert.equal(result.success, false);
    assert.match(result.error, /interrupted and cancelled/);
    assert.equal(result.diagnostics.interrupted, true);
    assert.equal(result.diagnostics.termination.sigintSent, true);
    assert.equal(result.diagnostics.termination.sigtermSent, false);
    assert.deepEqual(signals, ["SIGINT"]);
    assert.match(await readFile(reportPath, "utf8"), /interrupted and cancelled/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function riskFindingFixture(title, signature) {
  return {
    title,
    severity: "high",
    category: "reliability",
    status: "open",
    signature,
    affectedPaths: ["src/index.ts"],
    evidence: `${title} evidence`,
    evidenceReferences: [{ path: "src/index.ts", startLine: 1, endLine: 1, quote: "export", symbol: null }],
    problemRationale: `${title} rationale`,
    recommendedFix: `${title} fix`,
    reproduction: `Inspect ${title}.`,
    suggestedRegressionTest: `Test ${title}.`,
    minimumFixScope: "src/index.ts",
    estimatedEffort: "small",
    confidence: "high",
    findingType: "atomic",
    parentId: null,
    parentTitle: null,
    childFindings: []
  };
}
