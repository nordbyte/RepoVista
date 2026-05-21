import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { WriteStream } from "node:fs";
import { signalProcess } from "./process-runner.js";
import { getReportProvider } from "./providers/index.js";
import { renderStructuredProviderOutput } from "./provider-schema.js";
import { createSensitiveTextMasker, maskSensitiveText } from "./secrets.js";
import type { ProviderRunDiagnostics, ProviderRunRequest, ProviderRunResult, ProviderUsageTelemetry } from "./types.js";

export type SpawnAdapter = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

const MAX_ERROR_TEXT = 8000;

export async function runProviderPhase(
  request: ProviderRunRequest,
  spawnAdapter: SpawnAdapter = spawn
): Promise<ProviderRunResult> {
  const startedAt = Date.now();
  const provider = getReportProvider(request.provider);
  const structured = await prepareStructuredOutput(request, provider.capabilities.outputSchema);
  const promptFile = await preparePromptFile(request, provider.capabilities.promptFile);
  const providerRequest = structured
    ? { ...request, outputSchemaPath: structured.schemaPath, structuredOutputPath: structured.outputPath, promptFilePath: promptFile?.promptPath }
    : { ...request, promptFilePath: promptFile?.promptPath };
  const args = provider.buildArgs(providerRequest);
  const useProcessGroup = process.platform !== "win32";
  const shouldStoreLogs = request.keepLogs || request.jsonEvents;
  const logStem = providerLogStem(request.phaseId, request.phaseTitle);
  const stdoutLogPath = shouldStoreLogs && request.logsDir
    ? path.join(request.logsDir, `${logStem}.stdout${provider.stdoutLogExtension(request)}`)
    : undefined;
  const stderrLogPath = shouldStoreLogs && request.logsDir
    ? path.join(request.logsDir, `${logStem}.stderr.log`)
    : undefined;

  if (request.logsDir && shouldStoreLogs) {
    await mkdir(request.logsDir, { recursive: true });
  }

  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams | undefined;
    let stdoutText = "";
    let stdoutOutput = "";
    let stderrText = "";
    let settled = false;
    let timedOut = false;
    let interrupted = false;
    let cancellationRequested = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let forcedSettleTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    const diagnostics: ProviderRunDiagnostics = {
      provider: provider.id,
      executable: provider.executable,
      args,
      phaseId: providerRequest.phaseId,
      phaseTitle: providerRequest.phaseTitle,
      processGroup: useProcessGroup,
      startedAt: new Date(startedAt).toISOString(),
      timeoutSeconds: providerRequest.timeoutSeconds,
      timedOut: false,
      interrupted: false,
      stdoutLogPath,
      stderrLogPath,
      structuredOutputPath: structured?.outputPath
    };
    const stdoutLog = stdoutLogPath ? createWriteStream(stdoutLogPath, { flags: "w" }) : undefined;
    const stderrLog = stderrLogPath ? createWriteStream(stderrLogPath, { flags: "w" }) : undefined;
    stdoutLog?.on("error", () => undefined);
    stderrLog?.on("error", () => undefined);
    const stdoutMasker = createSensitiveTextMasker();
    const stderrMasker = createSensitiveTextMasker();

    const finish = async (result: Omit<ProviderRunResult, "durationMs" | "reportPath" | "phaseId">) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (forcedSettleTimer) {
        clearTimeout(forcedSettleTimer);
      }
      process.off("SIGINT", interruptHandler);
      process.off("SIGTERM", interruptHandler);
      request.abortSignal?.removeEventListener("abort", abortHandler);
      diagnostics.endedAt = new Date().toISOString();
      diagnostics.telemetry = extractProviderUsageTelemetry(stdoutText, stderrText);
      writeMasked(stdoutLog, stdoutMasker.flush());
      writeMasked(stderrLog, stderrMasker.flush());
      await Promise.all([
        closeLog(stdoutLog),
        closeLog(stderrLog)
      ]);
      resolve({
        phaseId: providerRequest.phaseId,
        reportPath: providerRequest.reportPath,
        durationMs: Date.now() - startedAt,
        stdoutLogPath,
        stderrLogPath,
        structuredOutputPath: structured?.outputPath,
        diagnostics,
        ...result
      });
      if (structured?.tempDir) {
        await rm(structured.tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (promptFile?.tempDir) {
        await rm(promptFile.tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    };

    const terminateChild = (reason: "timeout" | "interrupt") => {
      if (settled || diagnostics.termination) {
        return;
      }
      if (reason === "timeout") {
        timedOut = true;
        diagnostics.timedOut = true;
      } else {
        interrupted = true;
        diagnostics.interrupted = true;
      }
      if (!child) {
        cancellationRequested = reason === "interrupt";
        return;
      }
      diagnostics.termination = diagnostics.termination ?? {
        reason,
        sigintSent: false,
        sigtermSent: false,
        sigkillSent: false,
        forcedSettle: false,
        errors: []
      };
      diagnostics.termination.reason = reason;
      if (reason === "interrupt") {
        diagnostics.termination.sigintSent = true;
        diagnostics.termination.sigintAt = new Date().toISOString();
        diagnostics.termination.errors.push(...signalProcess(child, useProcessGroup, "SIGINT"));
      } else {
        diagnostics.termination.sigtermSent = true;
        diagnostics.termination.sigtermAt = new Date().toISOString();
        diagnostics.termination.errors.push(...signalProcess(child, useProcessGroup, "SIGTERM"));
      }
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          diagnostics.termination = diagnostics.termination ?? {
            reason,
            sigintSent: reason === "interrupt",
            sigtermSent: true,
            sigkillSent: false,
            forcedSettle: false,
            errors: []
          };
          if (!diagnostics.termination.sigtermSent) {
            diagnostics.termination.sigtermSent = true;
            diagnostics.termination.sigtermAt = new Date().toISOString();
            if (child) {
              diagnostics.termination.errors.push(...signalProcess(child, useProcessGroup, "SIGTERM"));
            }
            forceKillTimer = setTimeout(() => {
              if (!settled) {
                sendSigkill(reason);
              }
            }, 3000);
            forceKillTimer.unref();
            return;
          }
          sendSigkill(reason);
        }
      }, reason === "interrupt" ? 2000 : 5000);
      forceKillTimer.unref();
    };

    const sendSigkill = (reason: "timeout" | "interrupt") => {
      if (!settled) {
        diagnostics.termination = diagnostics.termination ?? {
          reason,
          sigintSent: reason === "interrupt",
          sigtermSent: true,
          sigkillSent: false,
          forcedSettle: false,
          errors: []
        };
        diagnostics.termination.sigkillSent = true;
        diagnostics.termination.sigkillAt = new Date().toISOString();
        if (child) {
          diagnostics.termination.errors.push(...signalProcess(child, useProcessGroup, "SIGKILL"));
        }
        forcedSettleTimer = setTimeout(() => {
          if (settled) {
            return;
          }
          if (diagnostics.termination) {
            diagnostics.termination.forcedSettle = true;
          }
          const message = reason === "timeout"
            ? `${provider.displayName} run timed out after ${providerRequest.timeoutSeconds} seconds and did not exit after SIGKILL.`
            : `${provider.displayName} run was interrupted and did not exit after SIGKILL.`;
          void writeProviderFailureReport(providerRequest, message, stdoutText, stderrText)
            .then(() => finish({ success: false, exitCode: null, error: message }))
            .catch(() => finish({ success: false, exitCode: null, error: message }));
        }, 5000);
        forcedSettleTimer.unref();
      }
    };

    const interruptHandler = () => terminateChild("interrupt");
    const abortHandler = () => {
      cancellationRequested = true;
      terminateChild("interrupt");
    };
    request.abortSignal?.addEventListener("abort", abortHandler, { once: true });
    if (request.abortSignal?.aborted) {
      abortHandler();
    }

    try {
      child = spawnAdapter(provider.executable, args, {
        cwd: request.projectRoot,
        env: process.env,
        stdio: "pipe",
        detached: useProcessGroup
      });
      diagnostics.pid = child.pid;
      request.onProgress?.({
        kind: "spawned",
        phaseId: providerRequest.phaseId,
        at: new Date().toISOString(),
        pid: child.pid
      });
      if (cancellationRequested) {
        terminateChild("interrupt");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void writeProviderFailureReport(providerRequest, `Could not start ${provider.displayName}: ${message}`, undefined, undefined)
        .then(() => finish({ success: false, error: maskSensitiveText(message) }))
        .catch(() => finish({ success: false, error: maskSensitiveText(message) }));
      return;
    }

    process.once("SIGINT", interruptHandler);
    process.once("SIGTERM", interruptHandler);

    if (request.timeoutSeconds > 0) {
      timeoutTimer = setTimeout(() => terminateChild("timeout"), request.timeoutSeconds * 1000);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      writeMasked(stdoutLog, stdoutMasker.push(text));
      request.onProgress?.({
        kind: "output",
        phaseId: providerRequest.phaseId,
        at: new Date().toISOString(),
        stream: "stdout",
        bytes: chunk.length
      });
      if (provider.outputMode === "stdout") {
        stdoutOutput += text;
      }
      stdoutText = appendBounded(stdoutText, text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      writeMasked(stderrLog, stderrMasker.push(text));
      request.onProgress?.({
        kind: "output",
        phaseId: providerRequest.phaseId,
        at: new Date().toISOString(),
        stream: "stderr",
        bytes: chunk.length
      });
      stderrText = appendBounded(stderrText, text);
    });

    child.on("error", (error) => {
      const message = error.message;
      void writeProviderFailureReport(providerRequest, `Could not start ${provider.displayName}: ${message}`, stdoutText, stderrText)
        .then(() => finish({ success: false, error: maskSensitiveText(message) }))
        .catch(() => finish({ success: false, error: maskSensitiveText(message) }));
    });

    child.on("close", (code, signal) => {
      void (async () => {
        if (settled) {
          return;
        }
        diagnostics.exitCode = code;
        diagnostics.signal = signal;
        request.onProgress?.({
          kind: "closed",
          phaseId: providerRequest.phaseId,
          at: new Date().toISOString(),
          exitCode: code,
          signal
        });

        if (timedOut || interrupted) {
          const message = timedOut
            ? `${provider.displayName} run timed out after ${providerRequest.timeoutSeconds} seconds.`
            : `${provider.displayName} run was interrupted and cancelled.`;
          await writeProviderFailureReport(providerRequest, message, stdoutText, stderrText);
          await finish({ success: false, exitCode: code, error: signal ? `${message} Signal: ${signal}.` : message });
          return;
        }

        if (code !== 0) {
          const message = provider.classifyError(stderrText, code);
          await writeProviderFailureReport(providerRequest, message, stdoutText, stderrText);
          await finish({ success: false, exitCode: code, error: maskSensitiveText(message) });
          return;
        }

        if (provider.outputMode === "stdout") {
          const report = stdoutOutput.trim();
          if (report) {
            await writeFile(structured?.outputPath ?? providerRequest.reportPath, `${report}\n`, "utf8");
          }
        }

        if (structured) {
          const rendered = await renderStructuredReport(structured.kind, structured.outputPath);
          if (!rendered.ok) {
            const message = `${provider.displayName} run succeeded but produced malformed structured output: ${rendered.error}`;
            await writeProviderFailureReport(providerRequest, message, stdoutText, stderrText);
            await finish({ success: false, exitCode: code, error: maskSensitiveText(message) });
            return;
          }
          await writeFile(providerRequest.reportPath, rendered.markdown, "utf8");
        }

        const hasReport = await hasUsableReport(providerRequest.reportPath);
        if (!hasReport) {
          const message = `${provider.displayName} run succeeded but did not produce a usable final answer.`;
          await writeProviderFailureReport(providerRequest, message, stdoutText, stderrText);
          await finish({ success: false, exitCode: code, error: message });
          return;
        }

        await finish({ success: true, exitCode: code });
      })().catch(async (error) => {
        const message = maskSensitiveText(error instanceof Error ? error.message : String(error));
        try {
          await writeProviderFailureReport(providerRequest, message, stdoutText, stderrText);
        } catch {
          // The run still has to settle even if the failure report cannot be written.
        }
        await finish({ success: false, exitCode: code, error: message });
      });
    });

    if (!providerRequest.promptFilePath) {
      child.stdin.write(providerRequest.prompt);
    }
    child.stdin.end();
  });
}

async function preparePromptFile(
  request: ProviderRunRequest,
  providerSupportsPromptFile: boolean
): Promise<{ tempDir: string; promptPath: string } | undefined> {
  if (!providerSupportsPromptFile) {
    return undefined;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repovista-prompt-"));
  const promptPath = path.join(tempDir, `${request.phaseId}.prompt.txt`);
  await writeFile(promptPath, request.prompt, "utf8");
  return { tempDir, promptPath };
}

async function prepareStructuredOutput(
  request: ProviderRunRequest,
  providerSupportsSchema: boolean
): Promise<{ tempDir: string; schemaPath: string; outputPath: string; kind: NonNullable<ProviderRunRequest["outputSchemaKind"]> } | undefined> {
  if (!request.outputSchema || !request.outputSchemaKind || !providerSupportsSchema) {
    return undefined;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repovista-schema-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(
    path.dirname(request.reportPath),
    `${path.basename(request.reportPath, path.extname(request.reportPath))}.structured.json`
  );
  await writeFile(schemaPath, JSON.stringify(request.outputSchema), "utf8");
  return { tempDir, schemaPath, outputPath, kind: request.outputSchemaKind };
}

async function renderStructuredReport(
  kind: NonNullable<ProviderRunRequest["outputSchemaKind"]>,
  outputPath: string
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  try {
    const raw = await readFile(outputPath, "utf8");
    const markdown = renderStructuredProviderOutput(kind, raw);
    return { ok: true, markdown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function writeMasked(stream: WriteStream | undefined, value: string): void {
  if (stream && value) {
    stream.write(value);
  }
}

function closeLog(stream: WriteStream | undefined): Promise<void> {
  if (!stream || stream.destroyed || stream.writableEnded) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => resolve();
    stream.once("finish", done);
    stream.once("close", done);
    stream.once("error", done);
    stream.end();
  });
}

async function hasUsableReport(reportPath: string): Promise<boolean> {
  try {
    const reportStat = await stat(reportPath);
    if (!reportStat.isFile() || reportStat.size === 0) {
      return false;
    }
    const content = await readFile(reportPath, "utf8");
    return content.trim().length > 0;
  } catch {
    return false;
  }
}

async function writeProviderFailureReport(
  request: ProviderRunRequest,
  message: string,
  stdoutText: string | undefined,
  stderrText: string | undefined
): Promise<void> {
  const provider = getReportProvider(request.provider);
  const maskedMessage = maskSensitiveText(message);
  const stdout = stdoutText ? maskSensitiveText(stdoutText).trim() : undefined;
  const stderr = stderrText ? maskSensitiveText(stderrText).trim() : undefined;
  const body = `# ${request.phaseTitle}

## Status

Failed.

## Error

${maskedMessage}

## Notes

- RepoVista did not modify the target code.
- Selected provider: ${provider.displayName} (\`${provider.executable}\`).
- Check whether ${provider.displayName} is installed and authenticated.

${stderr ? `## ${provider.displayName} stderr\n\n\`\`\`text\n${truncate(stderr)}\n\`\`\`\n` : ""}
${stdout ? `## ${provider.displayName} stdout\n\n\`\`\`text\n${truncate(stdout)}\n\`\`\`\n` : ""}
`;
  await writeFile(request.reportPath, body, "utf8");
}

function appendBounded(current: string, addition: string): string {
  const next = current + addition;
  return next.length <= MAX_ERROR_TEXT ? next : next.slice(next.length - MAX_ERROR_TEXT);
}

function truncate(value: string): string {
  return value.length <= MAX_ERROR_TEXT ? value : `${value.slice(0, MAX_ERROR_TEXT)}\n... truncated ...`;
}

function providerLogStem(phaseId: string, phaseTitle: string): string {
  const titleSlug = slugify(phaseTitle);
  if (!titleSlug || titleSlug === phaseId) {
    return phaseId;
  }
  return `${phaseId}.${titleSlug}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function extractProviderUsageTelemetry(stdoutText: string, stderrText: string): ProviderUsageTelemetry | undefined {
  const stdout = parseUsageText(stdoutText);
  const stderr = parseUsageText(stderrText);
  const combined = mergeTelemetry(stdout, stderr);
  if (!combined) {
    return undefined;
  }
  return {
    source: stdout && stderr ? "combined" : stdout ? "stdout" : "stderr",
    ...combined
  };
}

function parseUsageText(text: string): Omit<ProviderUsageTelemetry, "source"> | undefined {
  if (!text.trim()) {
    return undefined;
  }
  const jsonTelemetry = parseJsonUsageTelemetry(text);
  const regexTelemetry = parseRegexUsageTelemetry(text);
  return mergeTelemetry(jsonTelemetry, regexTelemetry);
}

function parseJsonUsageTelemetry(text: string): Omit<ProviderUsageTelemetry, "source"> | undefined {
  let telemetry: Omit<ProviderUsageTelemetry, "source"> | undefined;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      telemetry = mergeTelemetry(telemetry, telemetryFromUnknown(parsed));
    } catch {
      // Ignore non-JSON provider output.
    }
  }
  return telemetry;
}

function telemetryFromUnknown(value: unknown): Omit<ProviderUsageTelemetry, "source"> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record,
    record.usage,
    record.token_usage,
    record.tokenUsage,
    record.metrics,
    record.response
  ];
  let telemetry: Omit<ProviderUsageTelemetry, "source"> | undefined;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const item = candidate as Record<string, unknown>;
    telemetry = mergeTelemetry(telemetry, {
      inputTokens: readNumber(item.input_tokens ?? item.inputTokens ?? item.prompt_tokens ?? item.promptTokens),
      outputTokens: readNumber(item.output_tokens ?? item.outputTokens ?? item.completion_tokens ?? item.completionTokens),
      totalTokens: readNumber(item.total_tokens ?? item.totalTokens),
      costUsd: readNumber(item.cost_usd ?? item.costUsd ?? item.cost)
    });
  }
  return telemetry;
}

function parseRegexUsageTelemetry(text: string): Omit<ProviderUsageTelemetry, "source"> | undefined {
  return removeEmptyTelemetry({
    inputTokens: firstNumber(text, [
      /\b(?:input|prompt)\s+tokens?\s*[:=]\s*([0-9][0-9,._]*)/i,
      /\b(?:input_tokens|prompt_tokens)\s*[:=]\s*([0-9][0-9,._]*)/i
    ]),
    outputTokens: firstNumber(text, [
      /\b(?:output|completion)\s+tokens?\s*[:=]\s*([0-9][0-9,._]*)/i,
      /\b(?:output_tokens|completion_tokens)\s*[:=]\s*([0-9][0-9,._]*)/i
    ]),
    totalTokens: firstNumber(text, [
      /\btotal\s+tokens?\s*[:=]\s*([0-9][0-9,._]*)/i,
      /\btotal_tokens\s*[:=]\s*([0-9][0-9,._]*)/i
    ]),
    costUsd: firstNumber(text, [
      /\bcost(?:\s+usd)?\s*[:=]\s*\$?([0-9]+(?:\.[0-9]+)?)/i,
      /\busd\s*[:=]\s*\$?([0-9]+(?:\.[0-9]+)?)/i
    ])
  });
}

function mergeTelemetry(
  left: Omit<ProviderUsageTelemetry, "source"> | undefined,
  right: Omit<ProviderUsageTelemetry, "source"> | undefined
): Omit<ProviderUsageTelemetry, "source"> | undefined {
  const merged = removeEmptyTelemetry({
    inputTokens: right?.inputTokens ?? left?.inputTokens,
    outputTokens: right?.outputTokens ?? left?.outputTokens,
    totalTokens: right?.totalTokens ?? left?.totalTokens,
    costUsd: right?.costUsd ?? left?.costUsd
  });
  if (merged && merged.totalTokens === undefined && (merged.inputTokens !== undefined || merged.outputTokens !== undefined)) {
    merged.totalTokens = (merged.inputTokens ?? 0) + (merged.outputTokens ?? 0);
  }
  return removeEmptyTelemetry(merged);
}

function removeEmptyTelemetry(value: Omit<ProviderUsageTelemetry, "source"> | undefined): Omit<ProviderUsageTelemetry, "source"> | undefined {
  if (!value) {
    return undefined;
  }
  return value.inputTokens !== undefined || value.outputTokens !== undefined || value.totalTokens !== undefined || value.costUsd !== undefined
    ? value
    : undefined;
}

function firstNumber(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = readNumber(match?.[1]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/,/g, "").replace(/_/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
