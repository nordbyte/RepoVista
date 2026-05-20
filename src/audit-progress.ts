import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { colorize, renderTuiTerminalFrame, shouldUseColor, TUI_ANSI } from "./tui.js";
import type { AuditPhaseProgress, AuditSettingsSummary, LoggerSink } from "./logger.js";
import type { AuditOptions } from "./types.js";

type ProgressStepStatus = "running" | "done" | "failed" | "cancelled" | "skipped";

interface ProgressStep {
  id?: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  status: ProgressStepStatus;
}

export interface AuditProgressController extends LoggerSink {
  readonly signal: AbortSignal;
  start(): void;
  finish(result: { exitCode: number; runDir?: string; error?: string; suppressSummary?: boolean }): void;
}

const REFRESH_MS = 1000;
const MAX_MESSAGES = 6;

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
      existing.status = "running";
      existing.endedAt = undefined;
    } else {
      this.steps.push({
        id: phase.id,
        label: phase.title,
        startedAt: Date.now(),
        status: "running"
      });
    }
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
      this.render();
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
      if (step.status === "running") {
        step.status = status;
        step.endedAt = now;
      }
    }
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
        lines.push(truncate(line, columns));
      }
      lines.push("");
    }
    const visibleStepCount = Math.max(4, rows - 10 - lines.length - Math.min(this.messages.length, MAX_MESSAGES));
    const visibleSteps = this.steps.slice(-visibleStepCount);
    if (!visibleSteps.length) {
      lines.push(colorize("  Waiting for the first audit step...", TUI_ANSI.dim, this.color));
    } else {
      for (const step of visibleSteps) {
        lines.push(truncate(`${statusIcon(step.status)} ${step.label} | ${formatElapsed((step.endedAt ?? Date.now()) - step.startedAt)}`, columns));
      }
    }
    if (this.messages.length) {
      lines.push("");
      lines.push(colorize("Recent events", TUI_ANSI.cyan, this.color));
      for (const message of this.messages.slice(-MAX_MESSAGES)) {
        lines.push(truncate(`- ${message}`, columns));
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
    case "running":
      return "[run]";
  }
}

function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function truncate(value: string, columns: number): string {
  return value.length <= columns ? value : `${value.slice(0, Math.max(0, columns - 4))}...`;
}
