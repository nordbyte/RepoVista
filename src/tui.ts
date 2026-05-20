import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { RepoVistaError } from "./errors.js";

export interface TuiKey {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
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
  searchQuery?: string;
}

export const TUI_ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  underline: "\x1b[4m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  orange: "\x1b[38;5;208m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  black: "\x1b[30m",
  bgCyan: "\x1b[46m",
  bgYellow: "\x1b[43m"
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

    const onKeypress = (value: string, key: TuiKey) => {
      void (async () => {
        await options.onKey({ ...key, sequence: value }, controls);
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
  const wrapped = wrapStyledTextLines(options.lines, columns, options.color, options.searchQuery);
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
  length: number;
}

function positionFooter(cursor: number, itemCount: number): string {
  return itemCount ? `${Math.min(cursor + 1, itemCount)}/${itemCount}` : "0/0";
}

function wrapStyledTextLines(
  lines: string[],
  columns: number,
  useColor: boolean,
  searchQuery?: string,
): WrappedStyledLine[] {
  const wrapped: WrappedStyledLine[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const isFence = /^\s*(```|~~~)/.test(line);
    if (!inFence && !isFence) {
      const table = markdownTableAt(lines, index);
      if (table) {
        wrapped.push(...renderMarkdownTable(table, columns, useColor));
        index += table.length - 1;
        continue;
      }
    }
    const baseSegments = !useColor
      ? [{ text: line }]
      : inFence || isFence
      ? [{ text: line, style: useColor ? TUI_ANSI.gray : undefined }]
      : markdownSegments(line);
    const segments = highlightSegments(baseSegments, searchQuery, useColor);
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

  const quote = line.match(/^(\s*> ?)(.*)$/);
  if (quote) {
    return [
      { text: quote[1], style: TUI_ANSI.gray },
      { text: quote[2], style: `${TUI_ANSI.cyan}${TUI_ANSI.dim}` }
    ];
  }

  const list = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
  if (list) {
    return [
      { text: `${list[1]}${list[2]} `, style: TUI_ANSI.yellow },
      ...inlineMarkdownSegments(list[3])
    ];
  }

  return inlineMarkdownSegments(line);
}

function inlineMarkdownSegments(line: string): StyledTextSegment[] {
  const segments: StyledTextSegment[] = [];
  let index = 0;

  const pushPlain = (value: string): void => {
    if (value) {
      segments.push({ text: value });
    }
  };

  while (index < line.length) {
    const boldStart = line.indexOf("**", index);
    const codeStart = line.indexOf("`", index);
    const linkStart = line.indexOf("[", index);
    const candidates = [boldStart, codeStart, linkStart].filter((value) => value >= 0);
    const next = candidates.length ? Math.min(...candidates) : -1;

    if (next < 0) {
      pushPlain(line.slice(index));
      break;
    }

    if (next > index) {
      pushPlain(line.slice(index, next));
      index = next;
      continue;
    }

    if (line.startsWith("**", index)) {
      const end = line.indexOf("**", index + 2);
      if (end > index + 2) {
        segments.push({ text: line.slice(index + 2, end), style: `${TUI_ANSI.bold}${TUI_ANSI.white}` });
        index = end + 2;
        continue;
      }
    }

    if (line[index] === "`") {
      const end = line.indexOf("`", index + 1);
      if (end > index + 1) {
        segments.push({ text: line.slice(index + 1, end), style: TUI_ANSI.green });
        index = end + 1;
        continue;
      }
    }

    if (line[index] === "[") {
      const labelEnd = line.indexOf("](", index + 1);
      const urlEnd = labelEnd >= 0 ? line.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd > index + 1 && urlEnd > labelEnd + 2) {
        segments.push({
          text: line.slice(index + 1, labelEnd),
          style: `${TUI_ANSI.cyan}${TUI_ANSI.underline}`
        });
        segments.push({
          text: ` (${line.slice(labelEnd + 2, urlEnd)})`,
          style: TUI_ANSI.gray
        });
        index = urlEnd + 1;
        continue;
      }
    }

    pushPlain(line[index]);
    index += 1;
  }

  return segments.length ? segments : [{ text: line }];
}

function highlightSegments(
  segments: StyledTextSegment[],
  searchQuery: string | undefined,
  useColor: boolean,
): StyledTextSegment[] {
  const query = searchQuery?.trim();
  if (!query || !useColor) {
    return segments;
  }

  const highlighted: StyledTextSegment[] = [];
  const needle = query.toLowerCase();
  for (const segment of segments) {
    const haystack = segment.text.toLowerCase();
    let index = 0;
    let match = haystack.indexOf(needle, index);
    while (match >= 0) {
      if (match > index) {
        highlighted.push({ text: segment.text.slice(index, match), style: segment.style });
      }
      highlighted.push({
        text: segment.text.slice(match, match + query.length),
        style: `${segment.style ?? ""}${TUI_ANSI.bgYellow}${TUI_ANSI.black}${TUI_ANSI.bold}`
      });
      index = match + query.length;
      match = haystack.indexOf(needle, index);
    }
    if (index < segment.text.length) {
      highlighted.push({ text: segment.text.slice(index), style: segment.style });
    }
  }
  return highlighted;
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
      if (lineLength === 0) {
        remaining = remaining.replace(/^\s+/, "");
        if (!remaining) {
          break;
        }
      }
      const available = Math.max(1, columns - lineLength);
      const chunkLength = wrappedChunkLength(remaining, available);
      const brokeAtWordBoundary = remaining.length > available && chunkLength < available;
      const chunk = remaining.slice(0, chunkLength);
      lineSegments.push({ text: chunk, style: segment.style });
      lineLength += chunk.length;
      remaining = remaining.slice(chunk.length);
      if ((lineLength >= columns || brokeAtWordBoundary) && remaining.length > 0) {
        flush();
      }
    }
  }

  flush();
  return wrapped;

  function flush(): void {
    wrapped.push({ styled: renderStyledSegments(lineSegments, useColor), length: lineLength });
    lineSegments = [];
    lineLength = 0;
  }
}

function wrappedChunkLength(value: string, maxLength: number): number {
  if (value.length <= maxLength) {
    return value.length;
  }
  if (maxLength < 8) {
    return maxLength;
  }
  const wordBoundary = value.lastIndexOf(" ", maxLength);
  return wordBoundary > 0 ? wordBoundary : maxLength;
}

function renderStyledSegments(segments: StyledTextSegment[], useColor: boolean): string {
  return segments.map((segment) => segment.style
    ? colorize(segment.text, segment.style, useColor)
    : segment.text).join("");
}

function markdownTableAt(lines: string[], start: number): string[] | undefined {
  const first = lines[start];
  const second = lines[start + 1];
  if (!first || !second || !isMarkdownTableRow(first) || !isMarkdownTableSeparator(second)) {
    return undefined;
  }
  const table = [first, second];
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!isMarkdownTableRow(line)) {
      break;
    }
    table.push(line);
  }
  return table;
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && splitMarkdownTableRow(trimmed).length >= 2;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) {
    value = value.slice(1);
  }
  if (value.endsWith("|")) {
    value = value.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (escaped) {
    current += "\\";
  }
  cells.push(current.trim());
  return cells;
}

function renderMarkdownTable(tableLines: string[], columns: number, useColor: boolean): WrappedStyledLine[] {
  const parsedRows = tableLines.map(splitMarkdownTableRow);
  const contentRows = [parsedRows[0], ...parsedRows.slice(2)];
  const columnCount = Math.max(...contentRows.map((row) => row.length));
  const rows = contentRows.map((row) => normalizeTableRow(row, columnCount));
  const widths = tableColumnWidths(rows, columnCount, columns, useColor);
  const rendered: WrappedStyledLine[] = [];

  rows.forEach((row, rowIndex) => {
    rendered.push(...renderMarkdownTableRow(row, widths, useColor));
    if (rowIndex === 0) {
      rendered.push(renderMarkdownTableSeparator(widths, useColor));
    }
  });
  return rendered;
}

function normalizeTableRow(row: string[] | undefined, columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row?.[index] ?? "");
}

function tableColumnWidths(rows: string[][], columnCount: number, columns: number, useColor: boolean): number[] {
  const desired = Array.from({ length: columnCount }, (_, column) => {
    const max = Math.max(...rows.map((row) => visibleMarkdownCellLength(row[column] ?? "", useColor)));
    return Math.max(1, max);
  });
  const borderWidth = columnCount * 3 + 1;
  const available = Math.max(columnCount, columns - borderWidth);
  const totalDesired = desired.reduce((sum, width) => sum + width, 0);
  if (totalDesired <= available) {
    return desired;
  }

  const minWidth = available >= columnCount * 6 ? 6 : available >= columnCount * 3 ? 3 : 1;
  const widths = desired.map((width) => Math.max(minWidth, Math.min(width, Math.floor(available / columnCount))));
  let total = widths.reduce((sum, width) => sum + width, 0);
  let remaining = available - total;
  while (remaining > 0) {
    const index = widestGrowableColumn(desired, widths);
    if (index < 0) {
      break;
    }
    widths[index] += 1;
    remaining -= 1;
  }
  total = widths.reduce((sum, width) => sum + width, 0);
  while (total > available) {
    const index = widestShrinkableColumn(widths, minWidth);
    if (index < 0) {
      break;
    }
    widths[index] -= 1;
    total -= 1;
  }
  return widths;
}

function widestGrowableColumn(desired: number[], widths: number[]): number {
  let best = -1;
  let deficit = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const currentDeficit = desired[index] - widths[index];
    if (currentDeficit > deficit) {
      best = index;
      deficit = currentDeficit;
    }
  }
  return best;
}

function widestShrinkableColumn(widths: number[], minWidth: number): number {
  let best = -1;
  let widest = 0;
  for (let index = 0; index < widths.length; index += 1) {
    if (widths[index] > minWidth && widths[index] > widest) {
      best = index;
      widest = widths[index];
    }
  }
  return best;
}

function visibleMarkdownCellLength(value: string, useColor: boolean): number {
  if (!useColor) {
    return value.replace(/\t/g, "  ").length;
  }
  return inlineMarkdownSegments(value)
    .map((segment) => segment.text.replace(/\t/g, "  ").length)
    .reduce((sum, length) => sum + length, 0);
}

function renderMarkdownTableRow(cells: string[], widths: number[], useColor: boolean): WrappedStyledLine[] {
  const wrappedCells = cells.map((cell, index) => wrapTableCell(cell, widths[index], useColor));
  const rowHeight = Math.max(1, ...wrappedCells.map((cell) => cell.length));
  const rows: WrappedStyledLine[] = [];
  for (let rowIndex = 0; rowIndex < rowHeight; rowIndex += 1) {
    const parts = ["|"];
    let length = 1;
    for (let column = 0; column < widths.length; column += 1) {
      const cellLine = wrappedCells[column][rowIndex] ?? { styled: "", length: 0 };
      parts.push(" ", cellLine.styled, " ".repeat(Math.max(0, widths[column] - cellLine.length)), " |");
      length += widths[column] + 3;
    }
    rows.push({ styled: parts.join(""), length });
  }
  return rows;
}

function wrapTableCell(cell: string, width: number, useColor: boolean): WrappedStyledLine[] {
  const segments = useColor ? inlineMarkdownSegments(cell) : [{ text: cell }];
  return wrapStyledSegments(segments, Math.max(1, width), useColor);
}

function renderMarkdownTableSeparator(widths: number[], useColor: boolean): WrappedStyledLine {
  const line = `|${widths.map((width) => ` ${"-".repeat(Math.max(1, width))} `).join("|")}|`;
  return {
    styled: colorize(line, TUI_ANSI.gray, useColor),
    length: line.length
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
