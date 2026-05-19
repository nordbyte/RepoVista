import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { RepoVistaError } from "./errors.js";

export interface TuiKey {
  name?: string;
  ctrl?: boolean;
}

export interface TuiSessionControls {
  requestRender(): void;
  renderNow(): void;
  finish(): void;
  isFinishing(): boolean;
}

export interface TuiSessionOptions<T> {
  input?: ReadStream;
  output?: WriteStream;
  notInteractiveMessage: string;
  notInteractiveCode: string;
  alternateScreen?: boolean;
  render(): string;
  onKey(key: TuiKey, controls: TuiSessionControls): void | Promise<void>;
  onFinish(): T | Promise<T>;
}

export interface TuiListFrameOptions {
  title: string;
  help: string;
  sectionTitle: string;
  items: string[];
  cursor: number;
  columns: number;
  rows: number;
  color: boolean;
  emptyMessage?: string;
  footer?: string;
}

export interface TuiTextFrameOptions {
  title: string;
  help: string;
  sectionTitle: string;
  lines: string[];
  scroll: number;
  columns: number;
  rows: number;
  color: boolean;
  footer?: string;
}

export const TUI_ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  bgCyan: "\x1b[46m"
} as const;

const RENDER_DEBOUNCE_MS = 16;

export async function runTuiSession<T>(options: TuiSessionOptions<T>): Promise<T> {
  const input = (options.input ?? process.stdin) as ReadStream;
  const output = (options.output ?? process.stdout) as WriteStream;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new RepoVistaError(options.notInteractiveMessage, options.notInteractiveCode);
  }

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    let lastFrame: string | undefined;
    let finishing = false;
    const useAlternateScreen = options.alternateScreen ?? true;

    const renderNow = () => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      const frame = options.render();
      if (frame !== lastFrame) {
        lastFrame = frame;
        output.write(renderTuiTerminalFrame(frame));
      }
    };

    const requestRender = () => {
      if (renderTimer || finishing) {
        return;
      }
      renderTimer = setTimeout(renderNow, RENDER_DEBOUNCE_MS);
      renderTimer.unref();
    };

    const cleanup = () => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write(useAlternateScreen ? "\x1b[?25h\x1b[?1049l" : "\x1b[?25h");
    };

    const finish = () => {
      if (finishing) {
        return;
      }
      finishing = true;
      void (async () => {
        try {
          cleanup();
          resolve(await options.onFinish());
        } catch (error) {
          reject(error);
        }
      })();
    };

    const controls: TuiSessionControls = {
      requestRender,
      renderNow,
      finish,
      isFinishing: () => finishing
    };

    const onKeypress = (_value: string, key: TuiKey) => {
      void (async () => {
        await options.onKey(key, controls);
        if (!finishing) {
          requestRender();
        }
      })().catch((error) => {
        cleanup();
        reject(error);
      });
    };

    output.write(useAlternateScreen ? "\x1b[?1049h\x1b[?25l" : "\x1b[?25l");
    renderNow();
    input.on("keypress", onKeypress);
  });
}

export function renderTuiListFrame(options: TuiListFrameOptions): string {
  const columns = Math.max(40, options.columns);
  const rows = Math.max(12, options.rows);
  const header = renderTuiHeader(options.title, options.help, options.sectionTitle, options.color);
  const footer = renderTuiFooter(options.footer ?? positionFooter(options.cursor, options.items.length), options.color);
  const availableRows = Math.max(4, rows - header.length - footer.length);
  const start = visibleStart(options.cursor, options.items.length, availableRows);
  const visibleItems = options.items.slice(start, start + availableRows);
  const lines = [...header];

  if (!options.items.length) {
    lines.push(colorize(`  ${options.emptyMessage ?? "No entries available."}`, TUI_ANSI.dim, options.color));
  } else {
    for (let offset = 0; offset < visibleItems.length; offset += 1) {
      const index = start + offset;
      lines.push(renderTuiMenuLine(visibleItems[offset] ?? "", index === options.cursor, columns, options.color));
    }
  }

  lines.push(...footer);
  return lines.join("\n");
}

export function renderTuiTextFrame(options: TuiTextFrameOptions): string {
  const columns = Math.max(40, options.columns);
  const rows = Math.max(12, options.rows);
  const header = renderTuiHeader(options.title, options.help, options.sectionTitle, options.color);
  const footer = renderTuiFooter(options.footer ?? "", options.color);
  const availableRows = Math.max(4, rows - header.length - footer.length);
  const wrapped = wrapStyledTextLines(options.lines, columns, options.color);
  const scroll = clamp(options.scroll, 0, Math.max(0, wrapped.length - availableRows));
  const visible = wrapped.slice(scroll, scroll + availableRows);
  const lines = [...header, ...visible.map((line) => line.styled)];

  while (lines.length < rows - footer.length) {
    lines.push("");
  }

  lines.push(...footer);
  return lines.join("\n");
}

export function renderTuiTerminalFrame(frame: string): string {
  const clearedLines = frame
    .split("\n")
    .map((line) => `${line}\x1b[K`)
    .join("\n");
  return `\x1b[H${clearedLines}\x1b[J`;
}

export function renderTuiHeader(title: string, help: string, sectionTitle: string, useColor: boolean): string[] {
  return [
    colorize(title, `${TUI_ANSI.bold}${TUI_ANSI.cyan}`, useColor),
    colorize(help, TUI_ANSI.dim, useColor),
    colorize(sectionTitle, TUI_ANSI.yellow, useColor),
    ""
  ];
}

export function renderTuiFooter(value: string, useColor: boolean): string[] {
  return [
    "",
    colorize(value, TUI_ANSI.dim, useColor)
  ];
}

export function renderTuiMenuLine(rawItem: string, active: boolean, columns: number, useColor: boolean): string {
  const marker = active ? ">" : " ";
  const label = truncatePlain(rawItem, Math.max(8, columns - 4));
  if (active) {
    return `${colorize(marker, TUI_ANSI.cyan, useColor)} ${colorize(` ${label} `, `${TUI_ANSI.bgCyan}${TUI_ANSI.white}`, useColor)}`;
  }
  return `${colorize(marker, TUI_ANSI.gray, useColor)} ${styleTuiMenuItem(label, useColor)}`;
}

export function styleTuiMenuItem(label: string, useColor: boolean): string {
  if (!useColor) {
    return label;
  }
  if (label.startsWith("[x]")) {
    return `${colorize("[x]", TUI_ANSI.green, true)}${label.slice(3)}`;
  }
  if (label.startsWith("[ ]")) {
    return `${colorize("[ ]", TUI_ANSI.gray, true)}${colorize(label.slice(3), TUI_ANSI.dim, true)}`;
  }
  if (label === "Save and exit") {
    return colorize(label, TUI_ANSI.green, true);
  }
  if (label === "Exit without saving") {
    return colorize(label, TUI_ANSI.yellow, true);
  }

  const separator = label.indexOf(":");
  if (separator > 0) {
    return `${colorize(label.slice(0, separator + 1), TUI_ANSI.cyan, true)}${label.slice(separator + 1)}`;
  }
  return label;
}

export function visibleStart(cursor: number, itemCount: number, visibleRows: number): number {
  if (itemCount <= visibleRows) {
    return 0;
  }
  const preferred = cursor - Math.floor(visibleRows / 2);
  return Math.min(Math.max(0, preferred), itemCount - visibleRows);
}

export function truncatePlain(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function colorize(value: string, code: string, useColor: boolean): string {
  return useColor ? `${code}${value}${TUI_ANSI.reset}` : value;
}

export function shouldUseColor(output: WriteStream): boolean {
  return Boolean(output.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb");
}

export function checkbox(selected: boolean, label: string): string {
  return `[${selected ? "x" : " "}] ${label}`;
}

export function wrappedLineCount(lines: string[], columns: number, color = true): number {
  return wrapStyledTextLines(lines, Math.max(40, columns), color).length;
}

interface StyledTextSegment {
  text: string;
  style?: string;
}

interface WrappedStyledLine {
  styled: string;
}

function positionFooter(cursor: number, itemCount: number): string {
  return itemCount ? `${Math.min(cursor + 1, itemCount)}/${itemCount}` : "0/0";
}

function wrapStyledTextLines(lines: string[], columns: number, useColor: boolean): WrappedStyledLine[] {
  const wrapped: WrappedStyledLine[] = [];
  let inFence = false;

  for (const line of lines) {
    const isFence = /^\s*(```|~~~)/.test(line);
    const segments = inFence || isFence || !useColor
      ? [{ text: line }]
      : markdownSegments(line);
    wrapped.push(...wrapStyledSegments(segments, columns, useColor));
    if (isFence) {
      inFence = !inFence;
    }
  }

  return wrapped;
}

function markdownSegments(line: string): StyledTextSegment[] {
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    return [{ text: line, style: headingStyle(heading[1].length) }];
  }

  const segments: StyledTextSegment[] = [];
  const boldPattern = /\*\*([^*\n]+)\*\*/g;
  let index = 0;
  for (const match of line.matchAll(boldPattern)) {
    const start = match.index ?? 0;
    if (start > index) {
      segments.push({ text: line.slice(index, start) });
    }
    segments.push({ text: match[1], style: `${TUI_ANSI.bold}${TUI_ANSI.white}` });
    index = start + match[0].length;
  }
  if (index < line.length) {
    segments.push({ text: line.slice(index) });
  }
  return segments.length ? segments : [{ text: line }];
}

function headingStyle(level: number): string {
  if (level <= 2) {
    return `${TUI_ANSI.bold}${TUI_ANSI.cyan}`;
  }
  if (level <= 4) {
    return `${TUI_ANSI.bold}${TUI_ANSI.yellow}`;
  }
  return `${TUI_ANSI.bold}${TUI_ANSI.green}`;
}

function wrapStyledSegments(segments: StyledTextSegment[], columns: number, useColor: boolean): WrappedStyledLine[] {
  const wrapped: WrappedStyledLine[] = [];
  let lineSegments: StyledTextSegment[] = [];
  let lineLength = 0;

  for (const segment of segments) {
    let remaining = segment.text.replace(/\t/g, "  ");
    if (!remaining) {
      continue;
    }
    while (remaining.length > 0) {
      if (lineLength >= columns) {
        flush();
      }
      const available = Math.max(1, columns - lineLength);
      const chunk = remaining.slice(0, available);
      lineSegments.push({ text: chunk, style: segment.style });
      lineLength += chunk.length;
      remaining = remaining.slice(chunk.length);
      if (lineLength >= columns && remaining.length > 0) {
        flush();
      }
    }
  }

  flush();
  return wrapped;

  function flush(): void {
    wrapped.push({ styled: renderStyledSegments(lineSegments, useColor) });
    lineSegments = [];
    lineLength = 0;
  }
}

function renderStyledSegments(segments: StyledTextSegment[], useColor: boolean): string {
  return segments.map((segment) => segment.style
    ? colorize(segment.text, segment.style, useColor)
    : segment.text).join("");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
