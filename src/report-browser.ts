import { lstat, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ReadStream, WriteStream } from "node:tty";
import { validateReportRoot } from "./reports.js";
import {
  renderTuiListFrame,
  renderTuiTextFrame,
  runTuiSession,
  shouldUseColor,
  wrappedLineCount,
  type TuiKey
} from "./tui.js";
import type { AuditMeta, AuditOptions, StructuredFinding } from "./types.js";

export interface ReportRunSummary {
  runId: string;
  runDir: string;
  startedAt?: string;
  completedAt?: string;
  provider?: string;
  model?: string;
  reasoning?: string;
  findingCount: number;
  exitCode?: number;
  sections: ReportSection[];
}

export interface ReportSection {
  id: string;
  title: string;
  fileName?: string;
  content: string;
}

export type ReportBrowserScreen = "runs" | "sections" | "viewer" | "confirm-delete";

export interface ReportBrowserState {
  screen: ReportBrowserScreen;
  runCursor: number;
  sectionCursor: number;
  scroll: number;
  markedRunDirs?: Set<string>;
  notice?: string;
}

const REPORT_SECTION_FILES: Array<{ id: string; title: string; fileName: string }> = [
  { id: "summary", title: "Summary", fileName: "index.md" },
  { id: "inventory", title: "Evidence Pack", fileName: "00-inventory.md" },
  { id: "architecture", title: "Architecture", fileName: "01-architecture-report.md" },
  { id: "code-quality", title: "Code Quality", fileName: "02-code-quality-report.md" },
  { id: "risk-and-bug", title: "Risk and Bug", fileName: "03-risk-and-bug-report.md" },
  { id: "feature-roadmap", title: "Feature Roadmap", fileName: "04-feature-roadmap.md" }
];

export async function runReportsMenu(
  options: AuditOptions,
  input = process.stdin as ReadStream,
  output = process.stdout as WriteStream,
  projectRoot = process.cwd()
): Promise<string> {
  const runs = await listReportRuns(projectRoot, options.outDir);
  if (!runs.length) {
    return "No RepoVista report runs found.\n";
  }

  const state: ReportBrowserState = {
    screen: "runs",
    runCursor: 0,
    sectionCursor: 0,
    scroll: 0
  };

  return runTuiSession({
    input,
    output,
    notInteractiveMessage: "The reports command requires an interactive terminal.",
    notInteractiveCode: "REPORTS_NOT_INTERACTIVE",
    render: () => renderReportsMenuFrame(runs, state, {
      columns: output.columns ?? 100,
      rows: output.rows ?? 30,
      color: shouldUseColor(output)
    }),
    onKey: async (key, controls) => {
      await handleReportBrowserKey(runs, state, key, output.rows ?? 30, output.columns ?? 100);
      if ((key.ctrl && key.name === "c") || key.name === "q") {
        controls.finish();
      }
    },
    onFinish: () => "\nReport browser closed.\n"
  });
}

export async function listReportRuns(projectRoot: string, outDir: string): Promise<ReportRunSummary[]> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  let entries;
  try {
    entries = await readdir(outRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => loadReportRun(path.join(outRoot, entry.name), entry.name)));
  return runs
    .filter((run): run is ReportRunSummary => Boolean(run))
    .sort((left, right) => sortTime(right) - sortTime(left) || right.runId.localeCompare(left.runId));
}

export function renderReportsMenuFrame(
  runs: ReportRunSummary[],
  state: ReportBrowserState,
  options: { columns: number; rows: number; color: boolean }
): string {
  const run = runs[state.runCursor];
  const section = run?.sections[state.sectionCursor];
  const markedRuns = selectedMarkedRuns(runs, state);
  if (state.screen === "confirm-delete") {
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter deletes marked reports | Esc cancels | q exits",
      sectionTitle: `Confirm deletion of ${markedRuns.length} report run(s)`,
      items: markedRuns.map(formatDeleteItem),
      cursor: -1,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No report runs are marked for deletion.",
      footer: "Deletion removes the complete run directories."
    });
  }

  if (state.screen === "viewer" && run && section) {
    return renderTuiTextFrame({
      title: "RepoVista Reports",
      help: "Up/Down scroll | PageUp/PageDown page | Home/End jump | Esc/Left returns | q exits",
      sectionTitle: `${run.runId} / ${section.title}`,
      lines: section.content.split(/\r?\n/),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: `${section.fileName ?? "combined"} | ${state.scroll + 1}+`
    });
  }

  if (state.screen === "sections" && run) {
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Up/Down move | Enter opens section | Esc/Left returns | q exits",
      sectionTitle: `${run.runId} sections`,
      items: run.sections.map(formatSectionItem),
      cursor: state.sectionCursor,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No report sections found.",
      footer: `${Math.min(state.sectionCursor + 1, run.sections.length)}/${run.sections.length} | ${run.runDir}`
    });
  }

  return renderTuiListFrame({
    title: "RepoVista Reports",
    help: "Up/Down move | Enter opens report | Space marks delete | d deletes marked | q exits",
    sectionTitle: "Report runs",
    items: runs.map((item) => formatRunItem(item, isRunMarked(state, item))),
    cursor: state.runCursor,
    columns: options.columns,
    rows: options.rows,
    color: options.color,
    emptyMessage: "No RepoVista report runs found.",
    footer: run ? formatRunsFooter(run, state, runs.length, markedRuns.length) : state.notice
  });
}

async function handleReportBrowserKey(runs: ReportRunSummary[], state: ReportBrowserState, key: TuiKey, rows: number, columns: number): Promise<void> {
  if ((key.ctrl && key.name === "c") || key.name === "q") {
    return;
  }
  if (state.screen === "confirm-delete") {
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "runs";
      state.notice = "Deletion cancelled.";
    } else if (key.name === "return" || key.name === "enter" || key.name === "d" || key.name === "delete") {
      state.screen = "runs";
      state.runCursor = clampCursor(state.runCursor, runs.length);
      state.sectionCursor = 0;
      state.scroll = 0;
      try {
        const deleted = await deleteMarkedReportRuns(runs, markedRunDirs(state));
        state.runCursor = clampCursor(state.runCursor, runs.length);
        state.notice = `Deleted ${deleted} report run(s).`;
      } catch (error) {
        state.notice = `Delete failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return;
  }

  if (state.screen === "runs") {
    if (key.name === "up") {
      state.runCursor = wrapIndex(state.runCursor - 1, runs.length);
      state.notice = undefined;
    } else if (key.name === "down") {
      state.runCursor = wrapIndex(state.runCursor + 1, runs.length);
      state.notice = undefined;
    } else if (key.name === "space") {
      toggleMarkedRun(runs[state.runCursor], state);
    } else if (key.name === "d" || key.name === "delete") {
      if (selectedMarkedRuns(runs, state).length) {
        state.screen = "confirm-delete";
        state.notice = undefined;
      } else {
        state.notice = "No report runs marked for deletion.";
      }
    } else if (key.name === "return" || key.name === "enter") {
      if (runs[state.runCursor]) {
        state.screen = "sections";
        state.sectionCursor = 0;
        state.scroll = 0;
        state.notice = undefined;
      }
    }
    return;
  }

  const run = runs[state.runCursor];
  if (!run) {
    state.screen = "runs";
    return;
  }

  if (state.screen === "sections") {
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "runs";
      state.scroll = 0;
    } else if (key.name === "up") {
      state.sectionCursor = wrapIndex(state.sectionCursor - 1, run.sections.length);
    } else if (key.name === "down") {
      state.sectionCursor = wrapIndex(state.sectionCursor + 1, run.sections.length);
    } else if (key.name === "return" || key.name === "enter" || key.name === "right") {
      state.screen = "viewer";
      state.scroll = 0;
    }
    return;
  }

  if (state.screen === "viewer") {
    const section = run.sections[state.sectionCursor];
    const lineCount = section ? wrappedLineCount(section.content.split(/\r?\n/), columns) : 0;
    const page = Math.max(4, rows - 8);
    const maxScroll = Math.max(0, lineCount - page);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "sections";
      state.scroll = 0;
    } else if (key.name === "up") {
      state.scroll = Math.max(0, state.scroll - 1);
    } else if (key.name === "down") {
      state.scroll = Math.min(maxScroll, state.scroll + 1);
    } else if (key.name === "pageup") {
      state.scroll = Math.max(0, state.scroll - page);
    } else if (key.name === "pagedown" || key.name === "space") {
      state.scroll = Math.min(maxScroll, state.scroll + page);
    } else if (key.name === "home") {
      state.scroll = 0;
    } else if (key.name === "end") {
      state.scroll = maxScroll;
    }
  }
}

export async function deleteMarkedReportRuns(runs: ReportRunSummary[], markedDirs: Set<string>): Promise<number> {
  const selected = runs.filter((run) => markedDirs.has(run.runDir));
  let deleted = 0;
  for (const run of selected) {
    await assertDeletableReportRun(run);
    await rm(run.runDir, { recursive: true, force: false });
    markedDirs.delete(run.runDir);
    const index = runs.findIndex((item) => item.runDir === run.runDir);
    if (index >= 0) {
      runs.splice(index, 1);
    }
    deleted += 1;
  }
  return deleted;
}

async function loadReportRun(runDir: string, fallbackRunId: string): Promise<ReportRunSummary | undefined> {
  const marker = await hasRunMarker(runDir);
  if (!marker) {
    return undefined;
  }
  const [meta, findings, sections] = await Promise.all([
    readJson<AuditMeta>(path.join(runDir, "meta.json")),
    readJson<StructuredFinding[]>(path.join(runDir, "findings.json")),
    loadReportSections(runDir)
  ]);
  if (!sections.length) {
    return undefined;
  }
  return {
    runId: meta?.runId ?? fallbackRunId,
    runDir,
    startedAt: meta?.startedAt,
    completedAt: meta?.completedAt,
    provider: meta?.ai?.displayName ?? meta?.ai?.provider,
    model: cleanModelLabel(meta?.ai?.model, meta?.ai?.displayName) ?? cleanModelLabel(meta?.codex?.model, "Codex"),
    reasoning: cleanReasoningLabel(meta?.ai?.reasoning ?? meta?.codex?.reasoning),
    findingCount: findings?.length ?? meta?.findings?.length ?? countFindings(meta?.findingCounts),
    exitCode: meta?.exitCode,
    sections
  };
}

async function loadReportSections(runDir: string): Promise<ReportSection[]> {
  const loadedSections = await Promise.all(REPORT_SECTION_FILES.map(async (definition): Promise<ReportSection | undefined> => {
    const content = await readText(path.join(runDir, definition.fileName));
    return content === undefined ? undefined : {
      id: definition.id,
      title: definition.title,
      fileName: definition.fileName,
      content
    };
  }));
  const sections = loadedSections.filter((section): section is ReportSection => Boolean(section));

  if (!sections.length) {
    return [];
  }
  return [
    {
      id: "full",
      title: "Full Report",
      content: sections.map((section) => [
        `# ${section.title}`,
        "",
        section.content.trimEnd()
      ].join("\n")).join("\n\n---\n\n")
    },
    ...sections
  ];
}

async function hasRunMarker(runDir: string): Promise<boolean> {
  for (const fileName of ["meta.json", "summary.json", "00-inventory.md", "index.md"]) {
    try {
      const marker = await stat(path.join(runDir, fileName));
      if (marker.isFile()) {
        return true;
      }
    } catch {
      // Try the next marker.
    }
  }
  return false;
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function formatRunItem(run: ReportRunSummary, marked: boolean): string {
  const when = compactRunTime(run.completedAt ?? run.startedAt ?? run.runId);
  const model = `model: ${run.model ?? "default"}`;
  const reasoning = `reasoning: ${run.reasoning ?? "default"}`;
  const exit = run.exitCode === undefined ? "exit n/a" : `exit ${run.exitCode}`;
  return `${marked ? "[x]" : "[ ]"} ${when} | ${model} | ${reasoning} | ${run.findingCount} finding(s) | ${exit}`;
}

function formatDeleteItem(run: ReportRunSummary): string {
  return `${compactRunTime(run.completedAt ?? run.startedAt ?? run.runId)} | ${run.runId} | ${run.runDir}`;
}

function formatSectionItem(section: ReportSection): string {
  const lines = section.content.split(/\r?\n/).length;
  return `${section.title}: ${section.fileName ?? "combined"} | ${lines} line(s)`;
}

function cleanModelLabel(value: string | undefined, providerDisplayName: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const lower = trimmed.toLowerCase();
  const providerDefault = providerDisplayName ? `${providerDisplayName.toLowerCase()} configured default` : undefined;
  if (
    lower === providerDefault ||
    lower === "codex configured default" ||
    lower === "codex cli configured default" ||
    lower === "model default" ||
    lower === "configured default"
  ) {
    return undefined;
  }
  return trimmed;
}

function cleanReasoningLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "model default") {
    return undefined;
  }
  return trimmed;
}

function compactRunTime(value: string): string {
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (iso) {
    return `${iso[1]} ${iso[2]}:${iso[3]}`;
  }
  const runId = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  if (runId) {
    return `${runId[1]} ${runId[2]}:${runId[3]}`;
  }
  return value;
}

function formatRunsFooter(run: ReportRunSummary, state: ReportBrowserState, totalRuns: number, markedCount: number): string {
  const parts = [
    state.notice,
    `${Math.min(state.runCursor + 1, totalRuns)}/${totalRuns}`,
    `${markedCount} marked`,
    run.runId,
    run.runDir
  ];
  return parts.filter(Boolean).join(" | ");
}

function selectedMarkedRuns(runs: ReportRunSummary[], state: ReportBrowserState): ReportRunSummary[] {
  const marked = markedRunDirs(state);
  return runs.filter((run) => marked.has(run.runDir));
}

function markedRunDirs(state: ReportBrowserState): Set<string> {
  state.markedRunDirs ??= new Set<string>();
  return state.markedRunDirs;
}

function isRunMarked(state: ReportBrowserState, run: ReportRunSummary): boolean {
  return markedRunDirs(state).has(run.runDir);
}

function toggleMarkedRun(run: ReportRunSummary | undefined, state: ReportBrowserState): void {
  if (!run) {
    state.notice = "No report run selected.";
    return;
  }
  const marked = markedRunDirs(state);
  if (marked.has(run.runDir)) {
    marked.delete(run.runDir);
    state.notice = `Unmarked ${run.runId}.`;
  } else {
    marked.add(run.runDir);
    state.notice = `Marked ${run.runId} for deletion.`;
  }
}

async function assertDeletableReportRun(run: ReportRunSummary): Promise<void> {
  const runStat = await lstat(run.runDir);
  if (!runStat.isDirectory()) {
    throw new Error(`Report run is not a directory: ${run.runDir}`);
  }
  if (!(await hasRunMarker(run.runDir))) {
    throw new Error(`Report run is missing RepoVista marker files: ${run.runDir}`);
  }
}

function clampCursor(cursor: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, cursor), length - 1);
}

function sortTime(run: ReportRunSummary): number {
  const parsed = Date.parse(run.completedAt ?? run.startedAt ?? run.runId);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countFindings(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, value) => sum + value, 0);
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}
