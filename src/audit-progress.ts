import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { colorize, renderTuiTerminalFrame, shouldUseColor, TUI_ANSI } from "./tui.js";
import type { AuditPhaseProgress, AuditProviderEvent, AuditProviderProgress, AuditSettingsSummary, LoggerSink } from "./logger.js";
import type { AuditOptions } from "./types.js";

type ProgressStepStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "skipped";
type ProviderStepStatus = "queued" | "running" | "done" | "failed" | "cancelled";

interface ProgressStep {
  id?: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  status: ProgressStepStatus;
  providers?: Map<string, ProviderStep>;
}

interface ProviderStep {
  id: string;
  title: string;
  parentPhaseId: string;
  kind: AuditProviderProgress["kind"];
  status: ProviderStepStatus;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  pid?: number;
  lastOutputAt?: number;
  outputBytes: number;
  error?: string;
}

export interface AuditProgressController extends LoggerSink {
  readonly signal: AbortSignal;
  start(): void;
  finish(result: { exitCode: number; runDir?: string; error?: string; suppressSummary?: boolean }): void;
}

const REFRESH_MS = 1000;
const MAX_MESSAGES = 8;

export function createAuditProgressController(
  options: AuditOptions,
  abortController: AbortController,
  input = process.stdin as ReadStream,
  output = process.stderr as WriteStream
): AuditProgressController | undefined {
  if (!options.progress || options.ci || !input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return undefined;
  }
  return new TerminalAuditProgressController(abortController, input, output);
}

class TerminalAuditProgressController implements AuditProgressController {
  readonly handlesOutput = true;
  readonly signal: AbortSignal;
  private readonly startedAt = Date.now();
  private readonly color: boolean;
  private readonly steps: ProgressStep[] = [];
  private readonly messages: string[] = [];
  private auditSettingsSummary?: AuditSettingsSummary;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private previousRawMode = false;
  private status: "running" | "cancelling" | "finished" = "running";

  constructor(
    private readonly abortController: AbortController,
    private readonly input: ReadStream,
    private readonly output: WriteStream
  ) {
    this.signal = abortController.signal;
    this.color = shouldUseColor(output);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.previousRawMode = Boolean(this.input.isRaw);
    readline.emitKeypressEvents(this.input);
    this.input.setRawMode(true);
    this.input.resume();
    this.input.on("keypress", this.onKeypress);
    this.output.write("\x1b[?1049h\x1b[?25l");
    this.render();
    this.timer = setInterval(() => this.render(), REFRESH_MS);
    this.timer.unref();
  }

  finish(result: { exitCode: number; runDir?: string; error?: string; suppressSummary?: boolean }): void {
    if (!this.running) {
      return;
    }
    this.finishRunningSteps(result.exitCode === 130 ? "cancelled" : result.exitCode === 0 ? "done" : "failed");
    this.status = "finished";
    if (result.error) {
      this.pushMessage(`Error: ${result.error}`);
    }
    if (result.runDir) {
      this.pushMessage(`Run directory: ${result.runDir}`);
    }
    this.render();
    this.cleanup();
    if (result.suppressSummary) {
      return;
    }
    const summary = result.exitCode === 130
      ? "RepoVista audit cancelled."
      : result.exitCode === 0
        ? "RepoVista audit completed."
        : `RepoVista audit completed with exit code ${result.exitCode}.`;
    this.output.write(`${summary}${result.runDir ? ` ${result.runDir}` : ""}\n`);
  }

  info(message: string): void {
    this.pushMessage(message);
  }

  auditSettings(summary: AuditSettingsSummary): void {
    this.auditSettingsSummary = summary;
    this.render();
  }

  step(message: string): void {
    this.finishCurrentLinearStep("done");
    this.steps.push({
      label: message,
      startedAt: Date.now(),
      status: "running"
    });
    this.render();
  }

  phaseStarted(phase: AuditPhaseProgress): void {
    const existing = this.steps.find((step) => step.id === phase.id);
    if (existing) {
      existing.label = phase.title;
      existing.status = "queued";
      existing.endedAt = undefined;
      existing.providers?.clear();
    } else {
      this.steps.push({
        id: phase.id,
        label: phase.title,
        startedAt: Date.now(),
        status: "queued",
        providers: new Map()
      });
    }
    this.pushMessage(`${phase.title} queued.`);
    this.render();
  }

  phaseFinished(phase: AuditPhaseProgress): void {
    const step = this.steps.find((item) => item.id === phase.id);
    if (!step) {
      this.steps.push({
        id: phase.id,
        label: phase.title,
        startedAt: Date.now(),
        endedAt: Date.now(),
        status: phase.status ?? "done"
      });
      this.render();
      return;
    }
    step.status = phase.status ?? "done";
    step.endedAt = Date.now();
    if (phase.error) {
      this.pushMessage(`${phase.title}: ${phase.error}`);
    } else {
      this.pushMessage(`${phase.title} ${phase.status ?? "done"}.`);
      this.render();
    }
  }

  providerQueued(provider: AuditProviderProgress): void {
    const step = this.stepForProvider(provider);
    const item = this.providerForProgress(step, provider);
    item.status = "queued";
    item.queuedAt = Date.now();
    this.pushMessage(`${provider.title} waiting for provider slot.`);
  }

  providerStarted(provider: AuditProviderProgress): void {
    const step = this.stepForProvider(provider);
    const item = this.providerForProgress(step, provider);
    const now = Date.now();
    item.status = "running";
    item.startedAt = now;
    item.endedAt = undefined;
    step.status = "running";
    this.pushMessage(`${provider.title} started.`);
  }

  providerEvent(event: AuditProviderEvent): void {
    const step = this.steps.find((item) => item.id === event.parentPhaseId);
    const provider = step?.providers?.get(event.providerId);
    if (!step || !provider) {
      return;
    }
    const at = Date.parse(event.at);
    const timestamp = Number.isFinite(at) ? at : Date.now();
    if (event.type === "spawned") {
      provider.pid = event.pid;
      provider.startedAt ??= timestamp;
      provider.status = "running";
      step.status = "running";
    } else if (event.type === "output") {
      provider.lastOutputAt = timestamp;
      provider.outputBytes += event.bytes ?? 0;
    } else if (event.type === "closed") {
      provider.endedAt = timestamp;
    }
    this.render();
  }

  providerFinished(provider: AuditProviderProgress): void {
    const step = this.stepForProvider(provider);
    const item = this.providerForProgress(step, provider);
    item.status = provider.status ?? "done";
    item.endedAt = Date.now();
    item.durationMs = provider.durationMs;
    item.error = provider.error;
    if (provider.error) {
      this.pushMessage(`${provider.title} ${item.status}: ${provider.error}`);
    } else {
      this.pushMessage(`${provider.title} ${item.status}.`);
    }
  }

  warn(message: string): void {
    this.pushMessage(`Warning: ${message}`);
  }

  error(message: string): void {
    this.pushMessage(`Error: ${message}`);
  }

  private readonly onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
    if ((key.ctrl && key.name === "c") || key.name === "q") {
      this.requestCancel(key.name === "q" ? "Cancelled from RepoVista progress TUI." : "Cancelled by Ctrl+C.");
    }
  };

  private requestCancel(message: string): void {
    if (this.abortController.signal.aborted) {
      return;
    }
    this.status = "cancelling";
    this.pushMessage(message);
    this.abortController.abort(new Error(message));
    this.render();
  }

  private finishCurrentLinearStep(status: ProgressStepStatus): void {
    const current = [...this.steps].reverse().find((step) => !step.id && step.status === "running");
    if (!current) {
      return;
    }
    current.status = status;
    current.endedAt = Date.now();
  }

  private finishRunningSteps(status: ProgressStepStatus): void {
    const now = Date.now();
    for (const step of this.steps) {
      if (step.status === "running" || step.status === "queued") {
        step.status = status;
        step.endedAt = now;
      }
    }
  }

  private stepForProvider(provider: AuditProviderProgress): ProgressStep {
    let step = this.steps.find((item) => item.id === provider.parentPhaseId);
    if (!step) {
      step = {
        id: provider.parentPhaseId,
        label: provider.parentPhaseId,
        startedAt: Date.now(),
        status: "queued",
        providers: new Map()
      };
      this.steps.push(step);
    }
    step.providers ??= new Map();
    return step;
  }

  private providerForProgress(step: ProgressStep, provider: AuditProviderProgress): ProviderStep {
    step.providers ??= new Map();
    let item = step.providers.get(provider.id);
    if (!item) {
      item = {
        id: provider.id,
        title: provider.title,
        parentPhaseId: provider.parentPhaseId,
        kind: provider.kind,
        status: provider.status ?? "queued",
        queuedAt: Date.now(),
        outputBytes: 0
      };
      step.providers.set(provider.id, item);
    }
    item.title = provider.title;
    item.kind = provider.kind;
    return item;
  }

  private pushMessage(message: string): void {
    if (!message.trim()) {
      return;
    }
    this.messages.push(message);
    while (this.messages.length > MAX_MESSAGES) {
      this.messages.shift();
    }
    this.render();
  }

  private render(): void {
    if (!this.running) {
      return;
    }
    const columns = Math.max(60, this.output.columns ?? 100);
    const rows = Math.max(14, this.output.rows ?? 30);
    const lines = [
      colorize("RepoVista Audit", `${TUI_ANSI.bold}${TUI_ANSI.cyan}`, this.color),
      colorize("q/Ctrl+C cancels and stops running provider sessions", TUI_ANSI.dim, this.color),
      colorize(`${this.statusLabel()} | total ${formatElapsed(Date.now() - this.startedAt)}`, TUI_ANSI.yellow, this.color),
      ""
    ];
    if (this.auditSettingsSummary) {
      lines.push(colorize(this.auditSettingsSummary.title, TUI_ANSI.cyan, this.color));
      for (const line of this.auditSettingsSummary.lines) {
        lines.push(...wrapPlainLine(line, columns));
      }
      lines.push("");
    }
    const visibleStepCount = Math.max(4, rows - 10 - lines.length - Math.min(this.messages.length, MAX_MESSAGES));
    const visibleSteps = this.steps.slice(-visibleStepCount);
    if (!visibleSteps.length) {
      lines.push(colorize("  Waiting for the first audit step...", TUI_ANSI.dim, this.color));
    } else {
      for (const step of visibleSteps) {
        lines.push(renderStepLine(step, columns, this.color));
      }
    }
    if (this.messages.length) {
      lines.push("");
      lines.push(colorize("Recent events", TUI_ANSI.cyan, this.color));
      for (const message of this.messages.slice(-MAX_MESSAGES)) {
        lines.push(...wrapPlainLine(`- ${message}`, columns));
      }
    }
    while (lines.length < rows - 2) {
      lines.push("");
    }
    lines.push(colorize("Cancel sends SIGINT to the provider group, then SIGTERM/SIGKILL if it does not exit.", TUI_ANSI.dim, this.color));
    this.output.write(renderTuiTerminalFrame(lines.join("\n")));
  }

  private statusLabel(): string {
    if (this.status === "cancelling") {
      return "cancelling";
    }
    if (this.status === "finished") {
      return "finished";
    }
    return "running";
  }

  private cleanup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.input.off("keypress", this.onKeypress);
    this.input.setRawMode(this.previousRawMode);
    if (!this.previousRawMode) {
      this.input.pause();
    }
    this.output.write("\x1b[?25h\x1b[?1049l");
    this.running = false;
  }
}

function renderStepLine(step: ProgressStep, columns: number, useColor: boolean): string {
  const icon = statusIcon(step.status);
  const detail = providerSummary(step);
  const plain = truncate(`${icon} ${step.label} | ${formatElapsed((step.endedAt ?? Date.now()) - step.startedAt)}${detail ? ` | ${detail}` : ""}`, columns);
  if (!plain.startsWith(icon)) {
    return plain;
  }
  return `${colorize(icon, statusIconStyle(step.status), useColor)}${plain.slice(icon.length)}`;
}

function statusIcon(status: ProgressStepStatus): string {
  switch (status) {
    case "done":
      return "[ok]";
    case "failed":
      return "[fail]";
    case "cancelled":
      return "[cancel]";
    case "skipped":
      return "[skip]";
    case "queued":
      return "[wait]";
    case "running":
      return "[run]";
  }
}

function statusIconStyle(status: ProgressStepStatus): string {
  switch (status) {
    case "done":
      return TUI_ANSI.green;
    case "failed":
    case "cancelled":
      return TUI_ANSI.red;
    case "running":
      return TUI_ANSI.orange;
    case "queued":
      return TUI_ANSI.yellow;
    case "skipped":
      return TUI_ANSI.gray;
  }
}

function providerSummary(step: ProgressStep): string {
  const providers = Array.from(step.providers?.values() ?? []);
  if (!providers.length) {
    return step.status === "queued" ? "waiting for provider work" : "";
  }
  const parts: string[] = [];
  const shards = providers.filter((provider) => provider.kind === "shard");
  if (shards.length) {
    const done = shards.filter((provider) => provider.status === "done").length;
    const failed = shards.filter((provider) => provider.status === "failed" || provider.status === "cancelled").length;
    const running = shards.filter((provider) => provider.status === "running").length;
    const queued = shards.filter((provider) => provider.status === "queued").length;
    parts.push(`shards ${done}/${shards.length} done${failed ? `, ${failed} failed` : ""}${running ? `, ${running} running` : ""}${queued ? `, ${queued} queued` : ""}`);
  }
  const synthesis = latestProviderOfKind(providers, "synthesis");
  if (synthesis) {
    parts.push(`synthesis ${providerStatusLabel(synthesis)}`);
  }
  const repair = latestProviderOfKind(providers, "repair");
  if (repair) {
    parts.push(`repair ${providerStatusLabel(repair)}`);
  }
  const deepReview = providers.filter((provider) => provider.kind === "deep-review");
  if (deepReview.length) {
    const done = deepReview.filter((provider) => provider.status === "done").length;
    const running = deepReview.filter((provider) => provider.status === "running").length;
    parts.push(`deep review ${done}/${deepReview.length} done${running ? `, ${running} running` : ""}`);
  }
  const phaseProvider = latestProviderOfKind(providers, "phase");
  if (phaseProvider && !shards.length && !synthesis) {
    parts.push(`provider ${providerStatusLabel(phaseProvider)}`);
  }
  const runningProviders = providers.filter((provider) => provider.status === "running");
  if (runningProviders.length) {
    const pids = runningProviders.map((provider) => provider.pid).filter((pid): pid is number => typeof pid === "number");
    if (pids.length) {
      parts.push(`pid ${pids.join(",")}`);
    }
    const lastOutputAt = Math.max(...runningProviders.map((provider) => provider.lastOutputAt ?? 0));
    if (lastOutputAt > 0) {
      const idleMs = Date.now() - lastOutputAt;
      parts.push(`last output ${formatElapsedShort(idleMs)} ago${idleMs >= 60_000 ? ", waiting for model response" : ""}`);
    } else {
      parts.push("waiting for provider output");
    }
  }
  return parts.join(" | ");
}

function latestProviderOfKind(providers: ProviderStep[], kind: ProviderStep["kind"]): ProviderStep | undefined {
  return providers.filter((provider) => provider.kind === kind).at(-1);
}

function providerStatusLabel(provider: ProviderStep): string {
  if (provider.status === "running" && provider.startedAt) {
    return `running ${formatElapsed(Date.now() - provider.startedAt)}`;
  }
  if (provider.status === "queued") {
    return "queued";
  }
  if ((provider.status === "done" || provider.status === "failed" || provider.status === "cancelled") && provider.durationMs !== undefined) {
    return `${provider.status} ${formatElapsed(provider.durationMs)}`;
  }
  return provider.status;
}

function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatElapsedShort(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function truncate(value: string, columns: number): string {
  return value.length <= columns ? value : `${value.slice(0, Math.max(0, columns - 4))}...`;
}

function wrapPlainLine(value: string, columns: number): string[] {
  const max = Math.max(20, columns);
  if (value.length <= max) {
    return [value];
  }
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > max) {
    const breakpoint = remaining.lastIndexOf(" | ", max);
    const splitAt = breakpoint > 8 ? breakpoint + 3 : wordBreakpoint(remaining, max);
    lines.push(remaining.slice(0, splitAt).trimEnd());
    remaining = `  ${remaining.slice(splitAt).trimStart()}`;
  }
  if (remaining.trim()) {
    lines.push(remaining);
  }
  return lines;
}

function wordBreakpoint(value: string, max: number): number {
  if (value.length <= max) {
    return value.length;
  }
  const index = value.lastIndexOf(" ", max);
  return index > 8 ? index : max;
}
