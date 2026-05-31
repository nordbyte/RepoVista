import { spawn } from "node:child_process";
import { lstat, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReadStream, WriteStream } from "node:tty";
import { runCompareCommand } from "./compare.js";
import { runGithubStatusCommand } from "./github-status.js";
import { runPublishCommand } from "./publish.js";
import {
  findingPublishReadiness,
  findingQueueMarker,
  findingWorkflowFilterLabel,
  matchesFindingWorkflowFilter,
  nextFindingWorkflowFilter,
  renderStructuredFindingDetail,
  type FindingWorkflowFilter
} from "./finding-view.js";
import { resolveProviderDefaultModel } from "./provider-models.js";
import { validateReportRoot } from "./reports.js";
import {
  renderTuiListFrame,
  renderTuiTextFrame,
  runTuiSession,
  shouldUseColor,
  truncatePlain,
  wrappedLineCount,
  type TuiKey
} from "./tui.js";
import type { AuditMeta, AuditOptions, FindingEvidenceReference, FindingStatus, PublishTarget, StructuredFinding } from "./types.js";

export type ReportDefaultModelResolver = (provider: string, run: {
  runId: string;
  runDir: string;
  displayName?: string;
}) => Promise<string | undefined>;

export interface ReportRunListOptions {
  defaultModelResolver?: ReportDefaultModelResolver;
}

export interface ReportRunSummary {
  runId: string;
  runDir: string;
  projectRoot: string;
  meta?: AuditMeta;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  provider?: string;
  model?: string;
  reasoning?: string;
  source?: AuditMeta["source"];
  findingCount: number;
  exitCode?: number;
  findings: StructuredFinding[];
  sections: ReportSection[];
  evidencePreviews: Record<string, EvidencePreview>;
  compareGroups?: ReportCompareGroups;
}

export interface ReportSection {
  id: string;
  title: string;
  fileName?: string;
  content: string;
  durationMs?: number;
  phaseTotalDurationMs?: number;
}

export interface EvidencePreview {
  absolutePath?: string;
  startLine?: number;
  endLine?: number;
  content: string;
  error?: string;
}

export interface ReportCompareGroups {
  added: StructuredFinding[];
  changed: StructuredFinding[];
  persisting: StructuredFinding[];
  resolved: StructuredFinding[];
}

export type ReportBrowserScreen =
  | "runs"
  | "sections"
  | "viewer"
  | "findings-list"
  | "finding-detail"
  | "evidence-detail"
  | "outline"
  | "global-search"
  | "compare-groups"
  | "bookmarks"
  | "export"
  | "help"
  | "confirm-publish"
  | "publish-output"
  | "confirm-delete";
export type ReportBrowserInitialScreen = "runs" | "sections" | "viewer";

export interface ReportBrowserState {
  screen: ReportBrowserScreen;
  runCursor: number;
  sectionCursor: number;
  scroll: number;
  markedRunDirs?: Set<string>;
  notice?: string;
  searchMode?: boolean;
  searchInput?: string;
  searchQuery?: string;
  searchMatchIndex?: number;
  searchScope?: ReportSearchScope;
  findingCursor?: number;
  evidenceCursor?: number;
  outlineCursor?: number;
  globalSearchCursor?: number;
  compareCursor?: number;
  exportCursor?: number;
  previousScreen?: ReportBrowserScreen;
  findingSort?: ReportFindingSort;
  layout?: ReportLayout;
  bookmarkedFindings?: Set<string>;
  bookmarkedSections?: Set<string>;
  markedFindingIds?: Set<string>;
  publishTarget?: PublishTarget;
  publishTargets?: Record<string, PublishTarget>;
  publishOutput?: string;
  publishFilter?: FindingWorkflowFilter;
  severityFilter?: ReportSeverityFilter;
  statusFilter?: ReportStatusFilter;
}

export type ReportSeverityFilter = "all" | StructuredFinding["severity"];
export type ReportStatusFilter = "all" | FindingStatus;
export type ReportFindingSort = "severity" | "confidence" | "status" | "owner" | "sla" | "path" | "first-seen";
export type ReportLayout = "compact" | "normal" | "detailed";
export type ReportSearchScope = "section" | "run" | "all";

export interface ReportBrowserLaunchOptions {
  initialRunDir?: string;
  initialScreen?: ReportBrowserInitialScreen;
  closeMessage?: string;
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
  projectRoot = process.cwd(),
  launchOptions: ReportBrowserLaunchOptions = {}
): Promise<string> {
  const runs = await listReportRuns(projectRoot, options.outDir);
  if (!runs.length) {
    return "No RepoVista report runs found.\n";
  }

  const state = createReportBrowserState(runs, launchOptions);

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
      await handleReportBrowserKey(runs, state, key, output.rows ?? 30, output.columns ?? 100, shouldUseColor(output), options, projectRoot);
      if ((key.ctrl && key.name === "c") || (!state.searchMode && key.name === "q")) {
        controls.finish();
      }
    },
    onFinish: () => launchOptions.closeMessage ?? "\nReport browser closed.\n"
  });
}

export function createReportBrowserState(
  runs: ReportRunSummary[],
  options: ReportBrowserLaunchOptions = {}
): ReportBrowserState {
  const initialRunCursor = findInitialRunCursor(runs, options.initialRunDir);
  const runCursor = initialRunCursor >= 0 ? initialRunCursor : 0;
  const run = runs[runCursor];
  const requestedScreen = initialRunCursor >= 0 ? options.initialScreen ?? "runs" : "runs";
  const screen = run && run.sections.length ? requestedScreen : "runs";
  return {
    screen,
    runCursor,
    sectionCursor: 0,
    scroll: 0,
    searchScope: "section",
    findingCursor: 0,
    evidenceCursor: 0,
    outlineCursor: 0,
    globalSearchCursor: 0,
    compareCursor: 0,
    exportCursor: 0,
    findingSort: "severity",
    layout: "normal",
    severityFilter: "all",
    statusFilter: "all",
    publishFilter: "all"
  };
}

export async function listReportRuns(projectRoot: string, outDir: string, options: ReportRunListOptions = {}): Promise<ReportRunSummary[]> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  let entries;
  try {
    entries = await readdir(outRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => loadReportRun(path.join(outRoot, entry.name), entry.name, projectRoot, options)));
  const sorted = runs
    .filter((run): run is ReportRunSummary => Boolean(run))
    .sort((left, right) => creationTime(right) - creationTime(left) || right.runId.localeCompare(left.runId));
  await attachCompareSections(projectRoot, sorted);
  return sorted;
}

function findInitialRunCursor(runs: ReportRunSummary[], initialRunDir: string | undefined): number {
  if (!initialRunDir) {
    return -1;
  }
  const target = path.resolve(initialRunDir);
  return runs.findIndex((run) => path.resolve(run.runDir) === target);
}

export function renderReportsMenuFrame(
  runs: ReportRunSummary[],
  state: ReportBrowserState,
  options: { columns: number; rows: number; color: boolean }
): string {
  const run = runs[state.runCursor];
  const section = run?.sections[state.sectionCursor];
  const markedRuns = selectedMarkedRuns(runs, state);
  if (state.screen === "confirm-publish" && run) {
    const selections = queuedFindingsForPublish(run, state);
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter publishes | d dry-run preview | Esc cancels | q exits",
      sectionTitle: `Publish ${selections.length} queued finding(s) to ${run.source?.repository ?? "n/a"}`,
      items: selections.map(({ finding, target }) => `${target.toUpperCase()} | ${finding.severity.toUpperCase()} | ${finding.id} | ${finding.title} | ${findingPublishReadiness(finding, Boolean(run.source))}`),
      cursor: -1,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No findings queued. Use i for issue or p for PR in the finding list.",
      footer: `${contextFooter(run, state)} | d previews all queued groups`
    });
  }

  if (state.screen === "publish-output") {
    return renderTuiTextFrame({
      title: "RepoVista Publish",
      help: "Esc returns | Enter returns | q exits",
      sectionTitle: "Publish Output",
      lines: (state.publishOutput ?? "No publish output.").split(/\r?\n/),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: contextFooter(run, state)
    });
  }

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

  if (state.screen === "help") {
    return renderTuiTextFrame({
      title: "RepoVista Reports",
      help: "Esc returns | q exits",
      sectionTitle: `Help: ${state.previousScreen ?? "reports"}`,
      lines: helpLines(state.previousScreen ?? "runs"),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: contextFooter(run, state)
    });
  }

  if (state.screen === "global-search") {
    const matches = globalSearchMatches(runs, state);
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: state.searchMode
        ? "Type search | Enter applies | Esc cancels | Backspace deletes"
        : "/ edit search | Tab scope | Enter opens match | Up/Down move | Esc returns | q exits",
      sectionTitle: `Global Search (${state.searchScope ?? "run"})`,
      items: matches.map(formatGlobalSearchMatch),
      cursor: state.globalSearchCursor ?? 0,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: state.searchQuery ? "No matches found." : "Press / to enter a search term.",
      footer: `${contextFooter(run, state)} | ${matches.length} match(es)`
    });
  }

  if (state.screen === "bookmarks") {
    const items = bookmarkItems(runs, state);
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter opens bookmark | b removes selected | Esc returns | q exits",
      sectionTitle: "Bookmarks",
      items: items.map((item) => item.label),
      cursor: state.globalSearchCursor ?? 0,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No bookmarks set in this TUI session.",
      footer: contextFooter(run, state)
    });
  }

  if (state.screen === "export" && run) {
    const items = exportItems();
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter exports current view | Esc returns | q exits",
      sectionTitle: "Export Current View",
      items: items.map((item) => item.label),
      cursor: state.exportCursor ?? 0,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No export formats available.",
      footer: contextFooter(run, state)
    });
  }

  if (state.screen === "outline" && run && section) {
    const outline = outlineItems(section);
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter jumps to heading | Up/Down move | Esc returns | q exits",
      sectionTitle: `${run.runId} / ${section.title} outline`,
      items: outline.map((item) => item.label),
      cursor: state.outlineCursor ?? 0,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No markdown headings found in this section.",
      footer: contextFooter(run, state)
    });
  }

  if (state.screen === "compare-groups" && run) {
    const items = compareGroupItems(run);
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter opens finding | Up/Down move | v markdown compare | Esc returns | q exits",
      sectionTitle: `${run.runId} compare groups`,
      items: items.map((item) => item.label),
      cursor: state.compareCursor ?? 0,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No previous run is available for grouped comparison.",
      footer: contextFooter(run, state)
    });
  }

  if (state.screen === "findings-list" && run) {
    const findings = sortedFilteredFindings(run.findings, state, run);
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter details | g/G sync GitHub | Space queue | i issue | p PR | c publish | 1-5 triage | s/f/t/r | e evidence | b bookmark",
      sectionTitle: `${run.runId} findings`,
      items: findings.map((finding) => formatFindingListItem(run, finding, state)),
      cursor: state.findingCursor ?? 0,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No findings match the current filters.",
      footer: `${contextFooter(run, state)} | sort ${state.findingSort ?? "severity"} | queued ${queuedFindingsForPublish(run, state).length}`
    });
  }

  if (state.screen === "finding-detail" && run) {
    const finding = currentFinding(run, state);
    const content = finding ? renderFindingDetail(run, finding, state) : "No finding selected.";
    return renderTuiTextFrame({
      title: "RepoVista Reports",
      help: "Up/Down scroll | g sync GitHub | e evidence | 1-5 triage | o editor | b bookmark | x export | Esc returns",
      sectionTitle: finding ? `${finding.severity.toUpperCase()}: ${finding.title}` : "Finding Detail",
      lines: content.split(/\r?\n/),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      searchQuery: state.searchQuery,
      footer: contextFooter(run, state, finding ? finding.id : undefined)
    });
  }

  if (state.screen === "evidence-detail" && run) {
    const finding = currentFinding(run, state);
    const content = finding ? renderFindingEvidenceDetail(run, finding, state) : "No finding selected.";
    return renderTuiTextFrame({
      title: "RepoVista Reports",
      help: "Up/Down scroll | o editor | b bookmark | Esc returns | q exits",
      sectionTitle: finding ? `${finding.id} evidence` : "Evidence",
      lines: content.split(/\r?\n/),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      searchQuery: state.searchQuery,
      footer: contextFooter(run, state)
    });
  }

  if (state.screen === "viewer" && run && section) {
    const content = renderSectionContent(run, section, state);
    const matches = state.searchQuery ? searchMatchCount(content, state.searchQuery) : 0;
    return renderTuiTextFrame({
      title: "RepoVista Reports",
      help: state.searchMode
        ? "Type search | Enter applies | Esc cancels | Backspace deletes"
        : "Up/Down scroll | / search | n next | o outline | g global | f severity | t status | e evidence | ? help",
      sectionTitle: `${run.runId} / ${section.title} | ${runContextLabel(run)}`,
      lines: content.split(/\r?\n/),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      searchQuery: state.searchQuery,
      footer: `${formatViewerFooter(section, state, matches)} | ${contextFooter(run, state)}`
    });
  }

  if (state.screen === "sections" && run) {
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Enter opens | f/t filters | h health | c compare | g search | b bookmark | ? help | Esc returns",
      sectionTitle: `${run.runId} sections | ${runContextLabel(run)}`,
      items: run.sections.map(formatSectionItem),
      cursor: state.sectionCursor,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No report sections found.",
      footer: `${Math.min(state.sectionCursor + 1, run.sections.length)}/${run.sections.length} | ${contextFooter(run, state)} | ${run.runDir}`
    });
  }

  return renderTuiListFrame({
    title: "RepoVista Reports",
    help: "Up/Down move | Enter opens report | Space marks delete | d deletes marked | g search | ? help | q exits",
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

async function handleReportBrowserKey(
  runs: ReportRunSummary[],
  state: ReportBrowserState,
  key: TuiKey,
  rows: number,
  columns: number,
  color: boolean,
  options: AuditOptions,
  projectRoot: string
): Promise<void> {
  if ((key.ctrl && key.name === "c") || (!state.searchMode && key.name === "q")) {
    return;
  }
  if (!state.searchMode && (key.name === "?" || key.sequence === "?")) {
    state.previousScreen = state.screen;
    state.screen = "help";
    state.scroll = 0;
    return;
  }
  if (!state.searchMode && key.name === "l") {
    state.layout = nextLayout(state.layout ?? "normal");
    state.notice = `Layout: ${state.layout}.`;
    return;
  }
  if (!state.searchMode && key.name === "m") {
    state.previousScreen = state.screen;
    state.screen = "bookmarks";
    state.globalSearchCursor = 0;
    return;
  }
  if (!state.searchMode && key.name === "x" && state.screen !== "runs" && state.screen !== "confirm-delete" && state.screen !== "confirm-publish" && state.screen !== "publish-output") {
    state.previousScreen = state.screen;
    state.screen = "export";
    state.exportCursor = 0;
    return;
  }
  if (!state.searchMode && key.name === "g" && key.sequence !== "G" && state.screen !== "findings-list" && state.screen !== "finding-detail" && state.screen !== "confirm-delete" && state.screen !== "confirm-publish" && state.screen !== "publish-output") {
    state.previousScreen = state.screen;
    state.screen = "global-search";
    state.searchScope = state.searchScope === "all" ? "all" : "run";
    state.globalSearchCursor = 0;
    state.searchMode = !state.searchQuery;
    state.searchInput = state.searchQuery ?? "";
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

  if (state.screen === "confirm-publish") {
    const run = runs[state.runCursor];
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = state.previousScreen ?? "findings-list";
      state.previousScreen = undefined;
      state.notice = "Publish cancelled.";
    } else if ((key.name === "return" || key.name === "enter" || key.name === "d") && run) {
      const dryRun = key.name === "d";
      const selections = queuedFindingsForPublish(run, state);
      if (!selections.length) {
        state.notice = "No findings queued for publishing.";
        return;
      }
      try {
        const output = await publishQueuedReportFindings(run, selections, options, projectRoot, dryRun);
        if (!dryRun) {
          state.markedFindingIds?.clear();
          state.publishTargets = {};
          await reloadReportRuns(runs, run.runDir, state, projectRoot, options);
        }
        state.publishOutput = output;
        state.notice = dryRun ? "Dry-run preview generated." : firstLine(output);
        state.screen = "publish-output";
        state.scroll = 0;
        return;
      } catch (error) {
        state.notice = `Publish failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      state.screen = state.previousScreen ?? "findings-list";
      state.previousScreen = undefined;
    }
    return;
  }

  if (state.screen === "publish-output") {
    if (key.name === "escape" || key.name === "left" || key.name === "backspace" || key.name === "return" || key.name === "enter") {
      state.screen = state.previousScreen ?? "findings-list";
      state.previousScreen = undefined;
      state.scroll = 0;
    } else if (key.name === "up") {
      state.scroll = Math.max(0, state.scroll - 1);
    } else if (key.name === "down") {
      state.scroll += 1;
    }
    return;
  }

  if (state.screen === "help") {
    if (key.name === "escape" || key.name === "left" || key.name === "backspace" || key.name === "return" || key.name === "enter") {
      state.screen = state.previousScreen ?? "runs";
      state.previousScreen = undefined;
      state.scroll = 0;
    } else if (key.name === "up") {
      state.scroll = Math.max(0, state.scroll - 1);
    } else if (key.name === "down") {
      state.scroll += 1;
    }
    return;
  }

  if (state.screen === "global-search") {
    if (state.searchMode) {
      handleSearchInput(state, key);
      state.globalSearchCursor = 0;
      return;
    }
    const matches = globalSearchMatches(runs, state);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = state.previousScreen ?? "sections";
      state.previousScreen = undefined;
    } else if (key.name === "/" || key.sequence === "/") {
      state.searchMode = true;
      state.searchInput = state.searchQuery ?? "";
    } else if (key.name === "tab") {
      state.searchScope = nextSearchScope(state.searchScope ?? "run");
      state.globalSearchCursor = 0;
    } else if (key.name === "up") {
      state.globalSearchCursor = wrapIndex((state.globalSearchCursor ?? 0) - 1, matches.length);
    } else if (key.name === "down") {
      state.globalSearchCursor = wrapIndex((state.globalSearchCursor ?? 0) + 1, matches.length);
    } else if ((key.name === "return" || key.name === "enter" || key.name === "right") && matches.length) {
      const match = matches[clampCursor(state.globalSearchCursor ?? 0, matches.length)];
      state.runCursor = match.runIndex;
      state.sectionCursor = match.sectionIndex;
      state.screen = "viewer";
      state.scroll = match.line;
      state.searchMatchIndex = 0;
    }
    return;
  }

  if (state.screen === "bookmarks") {
    const items = bookmarkItems(runs, state);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = state.previousScreen ?? "runs";
      state.previousScreen = undefined;
    } else if (key.name === "up") {
      state.globalSearchCursor = wrapIndex((state.globalSearchCursor ?? 0) - 1, items.length);
    } else if (key.name === "down") {
      state.globalSearchCursor = wrapIndex((state.globalSearchCursor ?? 0) + 1, items.length);
    } else if (key.name === "b" && items.length) {
      removeBookmark(items[clampCursor(state.globalSearchCursor ?? 0, items.length)], state);
      state.globalSearchCursor = clampCursor(state.globalSearchCursor ?? 0, Math.max(0, items.length - 1));
    } else if ((key.name === "return" || key.name === "enter" || key.name === "right") && items.length) {
      openBookmark(items[clampCursor(state.globalSearchCursor ?? 0, items.length)], runs, state);
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

  if (state.screen === "export") {
    const items = exportItems();
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = state.previousScreen ?? "sections";
      state.previousScreen = undefined;
    } else if (key.name === "up") {
      state.exportCursor = wrapIndex((state.exportCursor ?? 0) - 1, items.length);
    } else if (key.name === "down") {
      state.exportCursor = wrapIndex((state.exportCursor ?? 0) + 1, items.length);
    } else if ((key.name === "return" || key.name === "enter") && items.length) {
      try {
        const exported = await exportCurrentView(run, state, items[clampCursor(state.exportCursor ?? 0, items.length)].format);
        state.notice = `Exported ${exported}.`;
      } catch (error) {
        state.notice = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      state.screen = state.previousScreen ?? "sections";
      state.previousScreen = undefined;
    }
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
    } else if (key.name === "f") {
      state.severityFilter = nextSeverityFilter(state.severityFilter ?? "all");
      selectSectionById(run, state, "findings");
    } else if (key.name === "t") {
      state.statusFilter = nextStatusFilter(state.statusFilter ?? "all");
      selectSectionById(run, state, "findings");
    } else if (key.name === "r") {
      state.publishFilter = nextFindingWorkflowFilter(state.publishFilter);
      selectSectionById(run, state, "findings");
    } else if (key.name === "e") {
      selectSectionById(run, state, "evidence-refs");
    } else if (key.name === "c") {
      state.screen = "compare-groups";
      state.compareCursor = 0;
    } else if (key.name === "h") {
      selectSectionById(run, state, "health");
    } else if (key.name === "b") {
      toggleSectionBookmark(run, state);
    } else if (key.name === "o") {
      state.screen = "outline";
      state.outlineCursor = 0;
    } else if (key.name === "return" || key.name === "enter" || key.name === "right") {
      if (run.sections[state.sectionCursor]?.id === "findings") {
        state.screen = "findings-list";
        state.findingCursor = 0;
      } else if (run.sections[state.sectionCursor]?.id === "compare-previous") {
        state.screen = "compare-groups";
        state.compareCursor = 0;
      } else {
        state.screen = "viewer";
      }
      state.scroll = 0;
    }
    return;
  }

  if (state.screen === "outline") {
    const section = run.sections[state.sectionCursor];
    const outline = section ? outlineItems(section) : [];
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "viewer";
    } else if (key.name === "up") {
      state.outlineCursor = wrapIndex((state.outlineCursor ?? 0) - 1, outline.length);
    } else if (key.name === "down") {
      state.outlineCursor = wrapIndex((state.outlineCursor ?? 0) + 1, outline.length);
    } else if ((key.name === "return" || key.name === "enter" || key.name === "right") && outline.length) {
      state.screen = "viewer";
      state.scroll = outline[clampCursor(state.outlineCursor ?? 0, outline.length)].line;
    }
    return;
  }

  if (state.screen === "compare-groups") {
    const items = compareGroupItems(run);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "sections";
    } else if (key.name === "up") {
      state.compareCursor = wrapIndex((state.compareCursor ?? 0) - 1, items.length);
    } else if (key.name === "down") {
      state.compareCursor = wrapIndex((state.compareCursor ?? 0) + 1, items.length);
    } else if (key.name === "v") {
      selectSectionById(run, state, "compare-previous");
      state.screen = "viewer";
    } else if ((key.name === "return" || key.name === "enter" || key.name === "right") && items.length) {
      const item = items[clampCursor(state.compareCursor ?? 0, items.length)];
      if (item.finding) {
        selectFinding(run, state, item.finding);
        state.screen = "finding-detail";
        state.scroll = 0;
      }
    }
    return;
  }

  if (state.screen === "findings-list") {
    const findings = sortedFilteredFindings(run.findings, state, run);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "sections";
      selectSectionById(run, state, "findings");
    } else if (key.name === "up") {
      state.findingCursor = wrapIndex((state.findingCursor ?? 0) - 1, findings.length);
    } else if (key.name === "down") {
      state.findingCursor = wrapIndex((state.findingCursor ?? 0) + 1, findings.length);
    } else if (key.name === "s") {
      state.findingSort = nextFindingSort(state.findingSort ?? "severity");
      state.findingCursor = 0;
    } else if (key.name === "f") {
      state.severityFilter = nextSeverityFilter(state.severityFilter ?? "all");
      state.findingCursor = 0;
    } else if (key.name === "t") {
      state.statusFilter = nextStatusFilter(state.statusFilter ?? "all");
      state.findingCursor = 0;
    } else if (key.name === "r") {
      state.publishFilter = nextFindingWorkflowFilter(state.publishFilter);
      state.findingCursor = 0;
    } else if (key.name === "space" && findings.length) {
      toggleQueuedFinding(findings[clampCursor(state.findingCursor ?? 0, findings.length)], state);
    } else if ((key.name === "i" || key.name === "p") && findings.length) {
      queueFindingForPublish(run, findings[clampCursor(state.findingCursor ?? 0, findings.length)], state, key.name === "p" ? "pr" : "issue");
    } else if ((key.name === "g" || key.sequence === "G") && findings.length) {
      const selected = key.sequence === "G" ? findings : [findings[clampCursor(state.findingCursor ?? 0, findings.length)]];
      await syncGithubStatusForReportFindings(run, selected, runs, state, options, projectRoot);
    } else if (key.name === "c") {
      beginPublish(run, findings[clampCursor(state.findingCursor ?? 0, findings.length)], state);
    } else if (isTriageKey(key) && findings.length) {
      await triageFinding(run, findings[clampCursor(state.findingCursor ?? 0, findings.length)], triageStatusForKey(key));
      state.notice = `Status set to ${triageStatusForKey(key)}.`;
    } else if (key.name === "b" && findings.length) {
      toggleFindingBookmark(run, findings[clampCursor(state.findingCursor ?? 0, findings.length)], state);
    } else if (key.name === "e" && findings.length) {
      state.screen = "evidence-detail";
      state.scroll = 0;
      state.evidenceCursor = 0;
    } else if (key.name === "v") {
      state.screen = "compare-groups";
      state.compareCursor = 0;
    } else if ((key.name === "return" || key.name === "enter" || key.name === "right") && findings.length) {
      state.screen = "finding-detail";
      state.scroll = 0;
    }
    return;
  }

  if (state.screen === "finding-detail") {
    const finding = currentFinding(run, state);
    const content = finding ? renderFindingDetail(run, finding, state) : "";
    const lineCount = wrappedLineCount(content.split(/\r?\n/), columns, color);
    const page = Math.max(4, rows - 8);
    const maxScroll = Math.max(0, lineCount - page);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "findings-list";
      state.scroll = 0;
    } else if (key.name === "e" && finding) {
      state.screen = "evidence-detail";
      state.scroll = 0;
      state.evidenceCursor = 0;
    } else if (key.name === "b" && finding) {
      toggleFindingBookmark(run, finding, state);
    } else if (key.name === "space" && finding) {
      toggleQueuedFinding(finding, state);
    } else if ((key.name === "i" || key.name === "p") && finding) {
      queueFindingForPublish(run, finding, state, key.name === "p" ? "pr" : "issue");
    } else if (key.name === "g" && finding) {
      await syncGithubStatusForReportFindings(run, [finding], runs, state, options, projectRoot);
    } else if (key.name === "c" && finding) {
      beginPublish(run, finding, state);
    } else if (key.name === "o" && finding) {
      state.notice = openFindingEvidenceInEditor(run, finding, state);
    } else if (isTriageKey(key) && finding) {
      await triageFinding(run, finding, triageStatusForKey(key));
      state.notice = `Status set to ${triageStatusForKey(key)}.`;
    } else if (key.name === "v") {
      state.screen = "compare-groups";
      state.compareCursor = 0;
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
    return;
  }

  if (state.screen === "evidence-detail") {
    const finding = currentFinding(run, state);
    const content = finding ? renderFindingEvidenceDetail(run, finding, state) : "";
    const lineCount = wrappedLineCount(content.split(/\r?\n/), columns, color);
    const page = Math.max(4, rows - 8);
    const maxScroll = Math.max(0, lineCount - page);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "finding-detail";
      state.scroll = 0;
    } else if (key.name === "o" && finding) {
      state.notice = openFindingEvidenceInEditor(run, finding, state);
    } else if (key.name === "b" && finding) {
      toggleFindingBookmark(run, finding, state);
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
    return;
  }

  if (state.screen === "viewer") {
    const section = run.sections[state.sectionCursor];
    if (state.searchMode) {
      handleSearchInput(state, key);
      if (!state.searchMode && state.searchQuery && section) {
        state.scroll = firstSearchMatchScroll(renderSectionContent(run, section, state), state.searchQuery, state.searchMatchIndex ?? 0);
      }
      return;
    }
    const content = section ? renderSectionContent(run, section, state) : "";
    const lineCount = section ? wrappedLineCount(content.split(/\r?\n/), columns, color) : 0;
    const page = Math.max(4, rows - 8);
    const maxScroll = Math.max(0, lineCount - page);
    if (key.name === "escape" || key.name === "left" || key.name === "backspace") {
      state.screen = "sections";
      state.scroll = 0;
    } else if (key.name === "/" || key.sequence === "/") {
      state.searchMode = true;
      state.searchInput = state.searchQuery ?? "";
      state.notice = undefined;
    } else if (key.name === "n" && section && state.searchQuery) {
      const matches = searchMatchScrolls(content, state.searchQuery);
      if (matches.length) {
        state.searchMatchIndex = ((state.searchMatchIndex ?? -1) + 1) % matches.length;
        state.scroll = Math.min(maxScroll, matches[state.searchMatchIndex]);
      }
    } else if (key.name === "f") {
      state.severityFilter = nextSeverityFilter(state.severityFilter ?? "all");
      state.scroll = 0;
    } else if (key.name === "t") {
      state.statusFilter = nextStatusFilter(state.statusFilter ?? "all");
      state.scroll = 0;
    } else if (key.name === "r") {
      state.publishFilter = nextFindingWorkflowFilter(state.publishFilter);
      state.scroll = 0;
    } else if (key.name === "e") {
      selectSectionById(run, state, "evidence-refs");
      state.screen = "viewer";
      state.scroll = 0;
    } else if (key.name === "h") {
      selectSectionById(run, state, "health");
      state.scroll = 0;
    } else if (key.name === "o") {
      state.screen = "outline";
      state.outlineCursor = 0;
    } else if (key.name === "b") {
      toggleSectionBookmark(run, state);
    } else if (key.name === "return" || key.name === "enter") {
      if (section?.id === "findings") {
        state.screen = "findings-list";
        state.findingCursor = 0;
        state.scroll = 0;
      } else if (section?.id === "compare-previous") {
        state.screen = "compare-groups";
        state.compareCursor = 0;
        state.scroll = 0;
      }
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

export async function loadReportRun(
  runDir: string,
  fallbackRunId: string,
  projectRoot: string,
  options: ReportRunListOptions
): Promise<ReportRunSummary | undefined> {
  const marker = await hasRunMarker(runDir);
  if (!marker) {
    return undefined;
  }
  const [meta, findings] = await Promise.all([
    readJson<AuditMeta>(path.join(runDir, "meta.json")),
    readJson<StructuredFinding[]>(path.join(runDir, "findings.json"))
  ]);
  const normalizedFindings = findings ?? meta?.findings ?? [];
  const resolvedProjectRoot = meta?.projectRoot ?? meta?.evidence?.projectRoot ?? projectRoot;
  const evidencePreviews = await loadEvidencePreviews(resolvedProjectRoot, normalizedFindings);
  const durationMs = runDurationMs(meta);
  const sections = await loadReportSections(runDir, meta, durationMs, normalizedFindings);
  if (!sections.length) {
    return undefined;
  }
  const providerId = meta?.ai?.provider ?? meta?.options?.provider ?? "codex";
  const displayName = meta?.ai?.displayName;
  const explicitModel = cleanModelLabel(meta?.ai?.model, displayName) ?? cleanModelLabel(meta?.codex?.model, "Codex");
  const resolvedModel = explicitModel ?? cleanModelLabel(await resolveRunDefaultModel(providerId, {
    runId: meta?.runId ?? fallbackRunId,
    runDir,
    displayName
  }, options), displayName);
  return {
    runId: meta?.runId ?? fallbackRunId,
    runDir,
    projectRoot: resolvedProjectRoot,
    meta,
    startedAt: meta?.startedAt,
    completedAt: meta?.completedAt,
    durationMs,
    provider: displayName ?? providerId,
    model: resolvedModel,
    reasoning: cleanReasoningLabel(meta?.ai?.reasoning ?? meta?.codex?.reasoning),
    source: meta?.source,
    findingCount: normalizedFindings.length || countFindings(meta?.findingCounts),
    exitCode: meta?.exitCode,
    findings: normalizedFindings,
    sections,
    evidencePreviews
  };
}

async function loadReportSections(runDir: string, meta: AuditMeta | undefined, runDuration: number | undefined, findings: StructuredFinding[]): Promise<ReportSection[]> {
  const durations = reportDurationByFile(meta);
  const phaseDurations = phaseTotalDurationByFile(meta);
  const loadedSections = await Promise.all(REPORT_SECTION_FILES.map(async (definition): Promise<ReportSection | undefined> => {
    const content = await readText(path.join(runDir, definition.fileName));
    return content === undefined ? undefined : {
      id: definition.id,
      title: definition.title,
      fileName: definition.fileName,
      content,
      durationMs: durations.get(definition.fileName),
      phaseTotalDurationMs: phaseDurations.get(definition.fileName)
    };
  }));
  const sections = loadedSections.filter((section): section is ReportSection => Boolean(section));

  if (!sections.length) {
    return [];
  }
  const generatedSections: ReportSection[] = [
    {
      id: "health",
      title: "Report Health",
      content: renderReportHealthSection(meta, findings)
    },
    {
      id: "findings",
      title: "Findings",
      content: renderFindingsSection(findings)
    },
    {
      id: "evidence-refs",
      title: "Evidence Refs",
      content: renderEvidenceRefsSection(findings)
    }
  ];
  return [
    {
      id: "full",
      title: "Full Report",
      content: sections.map((section) => [
        `# ${section.title}`,
        "",
        section.content.trimEnd()
      ].join("\n")).join("\n\n---\n\n"),
      durationMs: runDuration
    },
    ...generatedSections,
    ...sections
  ];
}

async function attachCompareSections(projectRoot: string, runs: ReportRunSummary[]): Promise<void> {
  for (let index = 0; index < runs.length - 1; index += 1) {
    const current = runs[index];
    const previous = runs[index + 1];
    current.compareGroups = buildCompareGroups(current.findings, previous.findings);
    try {
      current.sections.push({
        id: "compare-previous",
        title: "Compare Previous Run",
        content: await runCompareCommand(previous.runDir, current.runDir, projectRoot, { format: "markdown" })
      });
    } catch (error) {
      current.sections.push({
        id: "compare-previous",
        title: "Compare Previous Run",
        content: `# RepoVista Report Comparison\n\nCould not compare ${previous.runId} with ${current.runId}: ${error instanceof Error ? error.message : String(error)}\n`
      });
    }
  }
}

function renderSectionContent(run: ReportRunSummary, section: ReportSection, state: ReportBrowserState): string {
  if (section.id === "health") {
    return renderReportHealthSection(run.meta, run.findings);
  }
  if (section.id === "findings") {
    return renderFindingsSection(sortedFilteredFindings(run.findings, state, run), run);
  }
  if (section.id === "evidence-refs") {
    return renderEvidenceRefsSection(sortedFilteredFindings(run.findings, state, run), run);
  }
  if (section.id === "compare-previous" && run.compareGroups) {
    return renderCompareGroupsSection(run.compareGroups);
  }
  return section.content;
}

function filteredFindings(findings: StructuredFinding[], state: ReportBrowserState, run?: ReportRunSummary): StructuredFinding[] {
  const severity = state.severityFilter ?? "all";
  const status = state.statusFilter ?? "all";
  const query = state.searchQuery?.trim().toLowerCase();
  return findings.filter((finding) =>
    (severity === "all" || finding.severity === severity) &&
    (status === "all" || (finding.status ?? "open") === status) &&
    matchesFindingWorkflowFilter(finding, state.publishFilter, { publishable: Boolean(run?.source) }) &&
    (!query || findingSearchText(finding).includes(query))
  );
}

function sortedFilteredFindings(findings: StructuredFinding[], state: ReportBrowserState, run?: ReportRunSummary): StructuredFinding[] {
  return [...filteredFindings(findings, state, run)].sort((left, right) => compareFindings(left, right, state.findingSort ?? "severity"));
}

function renderFindingsSection(findings: StructuredFinding[], run?: ReportRunSummary): string {
  if (!findings.length) {
    return "# Findings\n\nNo findings match the current filters.\n";
  }
  return `# Findings\n\n${findings.map((finding, index) => [
    `## ${index + 1}. ${finding.severity.toUpperCase()}: ${finding.title}`,
    "",
    `- ID: ${finding.id}`,
    `- Status: ${finding.status ?? "open"}`,
    run?.compareGroups ? `- Diff: ${findingDiffLabel(run, finding)}` : undefined,
    `- Category: ${finding.category ?? "n/a"}`,
    `- Owner: ${finding.owner ?? "n/a"}`,
    `- Labels: ${finding.labels?.join(", ") || "n/a"}`,
    `- SLA: ${finding.sla ? `${finding.sla.dueAt}${finding.sla.overdue ? " (overdue)" : ""}` : "n/a"}`,
    `- Paths: ${finding.paths.join(", ") || "n/a"}`,
    "",
    `Evidence: ${finding.evidence ?? "n/a"}`,
    "",
    `Recommendation: ${finding.recommendation ?? "n/a"}`,
    "",
    `Issue: ${finding.issue?.url ?? "n/a"}`,
    "",
    "Evidence references:",
    renderEvidenceReferences(findingEvidenceReferences(finding)).map((line) => `- ${line}`).join("\n") || "- n/a"
  ].filter(Boolean).join("\n")).join("\n\n")}\n`;
}

function renderEvidenceRefsSection(findings: StructuredFinding[], run?: ReportRunSummary): string {
  const rows = findings.flatMap((finding) => findingEvidenceReferences(finding).map((reference) => ({
    finding,
    reference
  })));
  if (!rows.length) {
    return "# Evidence Refs\n\nNo evidence references match the current filters.\n";
  }
  return `# Evidence Refs\n\n${rows.map(({ finding, reference }, index) => [
    `## ${index + 1}. ${finding.id} - ${finding.title}`,
    "",
    `- Severity: ${finding.severity}`,
    `- Status: ${finding.status ?? "open"}`,
    `- Path: ${formatEvidenceReference(reference)}`,
    reference.quote ? `- Quote: ${reference.quote}` : undefined,
    run ? renderEvidencePreviewMarkdown(run, finding, reference) : undefined
  ].filter(Boolean).join("\n")).join("\n\n")}\n`;
}

function renderReportHealthSection(meta: AuditMeta | undefined, findings: StructuredFinding[]): string {
  const quality = meta?.analytics ? Math.max(0, Math.min(100, Math.round(100 - weakEvidenceFindings(findings).length * 5))) : undefined;
  const failedPhases = (meta?.phases ?? []).filter((phase) => phase.status === "failed");
  const repairAttempts = (meta?.phases ?? []).reduce((sum, phase) => sum + (phase.repairAttempts?.length ?? 0), meta?.options?.repairAttempts ?? 0);
  const driftWarnings = meta?.repositoryDrift?.warnings ?? [];
  const weakEvidence = weakEvidenceFindings(findings);
  const preflightWarnings = meta?.preflight?.warnings ?? [];
  const checks = [
    `- Quality score: ${quality === undefined ? "n/a" : `${quality}/100`}`,
    `- Repair attempts configured: ${repairAttempts}`,
    `- Weak evidence findings: ${weakEvidence.length}`,
    `- Repository drift: ${meta?.repositoryDrift?.detected ? "detected" : "not detected"}`,
    `- Failed phases/checks: ${failedPhases.length}`,
    `- Preflight warnings: ${preflightWarnings.length}`,
    `- Exit: ${meta?.exitCode ?? "n/a"}`
  ];
  const details = [
    failedPhases.length ? ["## Failed Phases", "", ...failedPhases.map((phase) => `- ${phase.id}: ${phase.status}${phase.error ? ` (${phase.error})` : ""}`)] : [],
    weakEvidence.length ? ["## Weak Evidence", "", ...weakEvidence.map((finding) => `- ${finding.id}: ${finding.title}`)] : [],
    driftWarnings.length ? ["## Drift Warnings", "", ...driftWarnings.map((warning) => `- ${warning}`)] : [],
    preflightWarnings.length ? ["## Preflight Warnings", "", ...preflightWarnings.map((warning) => `- ${warning}`)] : []
  ].flat();
  return ["# Report Health", "", ...checks, "", ...details].join("\n").trimEnd() + "\n";
}

function weakEvidenceFindings(findings: StructuredFinding[]): StructuredFinding[] {
  return findings.filter((finding) => {
    const references = findingEvidenceReferences(finding);
    return !references.length || finding.evidenceValidation?.passed === false || references.some((reference) => !reference.quote && !reference.startLine);
  });
}

function renderCompareGroupsSection(groups: ReportCompareGroups): string {
  const groupEntries: Array<[string, StructuredFinding[]]> = [
    ["Added", groups.added],
    ["Changed", groups.changed],
    ["Persisting", groups.persisting],
    ["Resolved", groups.resolved]
  ];
  return ["# Compare Previous Run", "", ...groupEntries.flatMap(([title, findings]) => [
    `## ${title} (${findings.length})`,
    "",
    ...(findings.length ? findings.map((finding) => `- ${finding.severity.toUpperCase()}: ${finding.id} - ${finding.title}`) : ["- n/a"]),
    ""
  ])].join("\n");
}

function buildCompareGroups(currentFindings: StructuredFinding[], previousFindings: StructuredFinding[]): ReportCompareGroups {
  const previousByKey = new Map(previousFindings.map((finding) => [findingCompareKey(finding), finding]));
  const currentKeys = new Set(currentFindings.map(findingCompareKey));
  const groups: ReportCompareGroups = {
    added: [],
    changed: [],
    persisting: [],
    resolved: []
  };

  for (const finding of currentFindings) {
    const previous = previousByKey.get(findingCompareKey(finding));
    if (!previous) {
      groups.added.push(finding);
    } else if (findingChanged(previous, finding)) {
      groups.changed.push(finding);
    } else {
      groups.persisting.push(finding);
    }
  }

  for (const finding of previousFindings) {
    if (!currentKeys.has(findingCompareKey(finding))) {
      groups.resolved.push(finding);
    }
  }

  return groups;
}

function findingCompareKey(finding: StructuredFinding): string {
  return finding.signature ?? finding.id ?? `${finding.title}:${finding.paths.join(",")}`;
}

function findingChanged(previous: StructuredFinding, current: StructuredFinding): boolean {
  return previous.severity !== current.severity ||
    (previous.status ?? "open") !== (current.status ?? "open") ||
    previous.title !== current.title ||
    previous.recommendation !== current.recommendation;
}

async function loadEvidencePreviews(projectRoot: string, findings: StructuredFinding[]): Promise<Record<string, EvidencePreview>> {
  const previews: Record<string, EvidencePreview> = {};
  await Promise.all(findings.flatMap((finding) => findingEvidenceReferences(finding).map(async (reference) => {
    previews[evidencePreviewKey(finding, reference)] = await readEvidencePreview(projectRoot, reference);
  })));
  return previews;
}

async function readEvidencePreview(projectRoot: string, reference: FindingEvidenceReference): Promise<EvidencePreview> {
  if (!reference.path) {
    return { content: "", error: "Evidence reference has no path." };
  }
  const absolutePath = path.resolve(projectRoot, reference.path);
  const root = path.resolve(projectRoot);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return { absolutePath, content: "", error: "Evidence path is outside the project root." };
  }
  try {
    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const quoteLine = reference.quote
      ? lines.findIndex((line) => line.includes(reference.quote as string)) + 1
      : 0;
    const startLine = Math.max(1, reference.startLine ?? quoteLine ?? 1);
    const endLine = Math.max(startLine, reference.endLine ?? startLine);
    const previewStart = Math.max(1, startLine - 2);
    const previewEnd = Math.min(lines.length, endLine + 2);
    const rendered = [];
    for (let line = previewStart; line <= previewEnd; line += 1) {
      const marker = line >= startLine && line <= endLine ? ">" : " ";
      rendered.push(`${marker} ${String(line).padStart(5, " ")} | ${lines[line - 1] ?? ""}`);
    }
    return {
      absolutePath,
      startLine,
      endLine,
      content: rendered.join("\n")
    };
  } catch (error) {
    return {
      absolutePath,
      startLine: reference.startLine,
      endLine: reference.endLine,
      content: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function evidencePreviewKey(finding: StructuredFinding, reference: FindingEvidenceReference): string {
  return `${finding.id}|${reference.path}|${reference.startLine ?? ""}|${reference.endLine ?? ""}|${reference.quote ?? ""}`;
}

function renderEvidencePreviewMarkdown(run: ReportRunSummary, finding: StructuredFinding, reference: FindingEvidenceReference): string | undefined {
  const preview = run.evidencePreviews[evidencePreviewKey(finding, reference)];
  if (!preview) {
    return undefined;
  }
  if (preview.error) {
    return `\nPreview: ${preview.error}`;
  }
  return [
    "",
    "Preview:",
    "```text",
    preview.content,
    "```"
  ].join("\n");
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
  const when = compactRunTime(run.startedAt ?? run.runId ?? run.completedAt);
  const source = sourceRunLabel(run);
  const mode = runModeLabel(run);
  const model = `model: ${run.model ?? "n/a"}`;
  const reasoning = `reasoning: ${run.reasoning ?? "n/a"}`;
  const exit = run.exitCode === undefined ? "exit n/a" : `exit ${run.exitCode}`;
  return `${marked ? "[x]" : "[ ]"} ${when}${mode ? ` | ${mode}` : ""} | ${model} | ${reasoning} | ${run.findingCount} finding(s) | ${exit} | total ${formatDuration(run.durationMs)}${source ? ` | ${source}` : ""}`;
}

function formatDeleteItem(run: ReportRunSummary): string {
  return `${compactRunTime(run.startedAt ?? run.runId ?? run.completedAt)} | ${run.runId} | ${run.runDir}`;
}

function formatSectionItem(section: ReportSection): string {
  const lines = section.content.split(/\r?\n/).length;
  const duration = section.id === "full"
    ? `total ${formatDuration(section.durationMs)}`
    : sectionDurationLabel(section);
  return `${section.title}: ${section.fileName ?? "combined"} | ${lines} line(s) | ${duration}`;
}

function formatViewerFooter(section: ReportSection, state: ReportBrowserState, matchCount = 0): string {
  const parts = [
    section.fileName ?? "combined",
    `${state.scroll + 1}+`,
    filterLabel(state),
    state.searchMode
      ? `search: ${state.searchInput ?? ""}`
      : state.searchQuery
        ? `search: ${state.searchQuery} (${matchPositionLabel(state, matchCount)})`
        : undefined
  ];
  return parts.filter(Boolean).join(" | ");
}

function filterLabel(state: ReportBrowserState): string {
  return `severity ${state.severityFilter ?? "all"} | status ${state.statusFilter ?? "all"} | ${findingWorkflowFilterLabel(state.publishFilter)}`;
}

function contextFooter(run: ReportRunSummary | undefined, state: ReportBrowserState, suffix?: string): string {
  if (!run) {
    return state.notice ?? "";
  }
  return [
    state.notice,
    runContextLabel(run),
    `total ${formatDuration(run.durationMs)}`,
    filterLabel(state),
    `scope ${state.searchScope ?? "section"}`,
    `layout ${state.layout ?? "normal"}`,
    suffix
  ].filter(Boolean).join(" | ");
}

function runContextLabel(run: ReportRunSummary): string {
  return [
    sourceRunLabel(run),
    runModeLabel(run),
    run.provider ?? "provider n/a",
    `model ${run.model ?? "n/a"}`,
    `reasoning ${run.reasoning ?? "n/a"}`,
    run.exitCode === undefined ? "exit n/a" : `exit ${run.exitCode}`
  ].filter(Boolean).join(" | ");
}

function runModeLabel(run: ReportRunSummary): string | undefined {
  return run.meta?.options?.bugFindingsOnly ? "mode: bug-findings" : undefined;
}

function sourceRunLabel(run: ReportRunSummary): string | undefined {
  if (!run.source) {
    return undefined;
  }
  return `source ${run.source.repository}@${run.source.ref ?? run.source.defaultBranch ?? run.source.commit.slice(0, 12)}`;
}

function matchPositionLabel(state: ReportBrowserState, matchCount: number): string {
  if (!matchCount) {
    return "0/0";
  }
  const index = Math.min(matchCount, Math.max(1, (state.searchMatchIndex ?? 0) + 1));
  return `${index}/${matchCount}`;
}

function searchMatchCount(content: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return 0;
  }
  return content
    .split(/\r?\n/)
    .reduce((count, line) => {
      let offset = 0;
      let matches = 0;
      const haystack = line.toLowerCase();
      while (haystack.indexOf(needle, offset) >= 0) {
        const index = haystack.indexOf(needle, offset);
        matches += 1;
        offset = index + needle.length;
      }
      return count + matches;
    }, 0);
}

function currentFinding(run: ReportRunSummary, state: ReportBrowserState): StructuredFinding | undefined {
  const findings = sortedFilteredFindings(run.findings, state, run);
  return findings[clampCursor(state.findingCursor ?? 0, findings.length)];
}

function selectFinding(run: ReportRunSummary, state: ReportBrowserState, finding: StructuredFinding): void {
  const findings = sortedFilteredFindings(run.findings, state, run);
  const index = findings.findIndex((item) => item.id === finding.id);
  state.findingCursor = index >= 0 ? index : 0;
}

function formatFindingListItem(run: ReportRunSummary, finding: StructuredFinding, state: ReportBrowserState): string {
  const bookmarked = findingBookmarks(state).has(findingBookmarkKey(run, finding)) ? "*" : " ";
  const queued = findingQueueMarker(queuedPublishTarget(state, finding.id));
  const diff = run.compareGroups ? `${findingDiffLabel(run, finding)} | ` : "";
  const owner = finding.owner ?? "owner n/a";
  const confidence = finding.confidence ? ` | confidence ${finding.confidence}` : "";
  const sla = finding.sla?.dueAt ? ` | SLA ${finding.sla.dueAt}${finding.sla.overdue ? " overdue" : ""}` : "";
  const pathLabel = finding.paths[0] ?? "path n/a";
  const readiness = ` | ${findingPublishReadiness(finding, Boolean(run.source))}`;
  if ((state.layout ?? "normal") === "compact") {
    return `[${queued}]${bookmarked} ${finding.severity.toUpperCase()} | ${finding.status ?? "open"} | ${finding.title}`;
  }
  if (state.layout === "detailed") {
    return `[${queued}]${bookmarked} ${diff}${finding.severity.toUpperCase()} | ${finding.status ?? "open"} | ${owner}${confidence}${sla} | ${pathLabel} | ${finding.title}${readiness}`;
  }
  return `[${queued}]${bookmarked} ${diff}${finding.severity.toUpperCase()} | ${finding.status ?? "open"} | ${owner} | ${pathLabel} | ${finding.title}${readiness}`;
}

function renderFindingDetail(run: ReportRunSummary, finding: StructuredFinding, state: ReportBrowserState): string {
  return renderStructuredFindingDetail(finding, {
    diffLabel: findingDiffLabel(run, finding),
    layout: state.layout ?? "normal",
    publishable: Boolean(run.source),
    sourceLabel: run.source?.repository,
    queueTarget: queuedPublishTarget(state, finding.id)
  }).join("\n");
}

function renderFindingEvidenceDetail(run: ReportRunSummary, finding: StructuredFinding, state: ReportBrowserState): string {
  const references = findingEvidenceReferences(finding);
  if (!references.length) {
    return `# Evidence\n\nNo evidence references available for ${finding.id}.\n`;
  }
  return [
    `# Evidence for ${finding.id}`,
    "",
    ...references.flatMap((reference, index) => {
      const preview = run.evidencePreviews[evidencePreviewKey(finding, reference)];
      const active = index === (state.evidenceCursor ?? 0) ? "current" : "ref";
      if (!preview) {
        return [`## ${index + 1}. ${formatEvidenceReference(reference)} (${active})`, "", "No preview loaded."];
      }
      return [
        `## ${index + 1}. ${formatEvidenceReference(reference)} (${active})`,
        "",
        reference.quote ? `> ${reference.quote}` : "",
        preview.error ? `Preview error: ${preview.error}` : "",
        preview.absolutePath ? `File: ${preview.absolutePath}${preview.startLine ? `:${preview.startLine}` : ""}` : "",
        "",
        preview.content ? "```text" : "",
        preview.content,
        preview.content ? "```" : ""
      ].filter(Boolean);
    })
  ].join("\n");
}

function findingDiffLabel(run: ReportRunSummary, finding: StructuredFinding): string {
  const groups = run.compareGroups;
  if (!groups) {
    return "n/a";
  }
  for (const [label, findings] of Object.entries(groups) as Array<[keyof ReportCompareGroups, StructuredFinding[]]>) {
    if (findings.some((item) => item.id === finding.id || findingCompareKey(item) === findingCompareKey(finding))) {
      return label;
    }
  }
  return "n/a";
}

function compareFindings(left: StructuredFinding, right: StructuredFinding, sort: ReportFindingSort): number {
  if (sort === "severity") {
    return severityRank(left.severity) - severityRank(right.severity) || left.title.localeCompare(right.title);
  }
  if (sort === "confidence") {
    return confidenceRank(right.confidence) - confidenceRank(left.confidence) || left.title.localeCompare(right.title);
  }
  if (sort === "status") {
    return (left.status ?? "open").localeCompare(right.status ?? "open") || severityRank(left.severity) - severityRank(right.severity);
  }
  if (sort === "owner") {
    return (left.owner ?? "").localeCompare(right.owner ?? "") || left.title.localeCompare(right.title);
  }
  if (sort === "sla") {
    return (left.sla?.dueAt ?? "9999").localeCompare(right.sla?.dueAt ?? "9999") || left.title.localeCompare(right.title);
  }
  if (sort === "path") {
    return (left.paths[0] ?? "").localeCompare(right.paths[0] ?? "") || left.title.localeCompare(right.title);
  }
  return (left.firstSeenRunId ?? left.createdAt ?? "").localeCompare(right.firstSeenRunId ?? right.createdAt ?? "") || left.title.localeCompare(right.title);
}

function severityRank(severity: StructuredFinding["severity"]): number {
  return { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 }[severity] ?? 5;
}

function confidenceRank(confidence: string | undefined): number {
  const value = confidence?.toLowerCase() ?? "";
  if (value.includes("high")) {
    return 3;
  }
  if (value.includes("medium")) {
    return 2;
  }
  if (value.includes("low")) {
    return 1;
  }
  return 0;
}

function outlineItems(section: ReportSection): Array<{ label: string; line: number }> {
  return section.content
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter((item) => /^#{1,6}\s+/.test(item.line))
    .map((item) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(item.line);
      const level = heading?.[1].length ?? 1;
      return {
        label: `${"  ".repeat(Math.max(0, level - 1))}${heading?.[2] ?? item.line}`,
        line: item.index
      };
    });
}

interface GlobalSearchMatch {
  runIndex: number;
  sectionIndex: number;
  line: number;
  label: string;
}

function globalSearchMatches(runs: ReportRunSummary[], state: ReportBrowserState): GlobalSearchMatch[] {
  const query = state.searchQuery?.trim().toLowerCase();
  if (!query) {
    return [];
  }
  const scope = state.searchScope ?? "run";
  const runIndexes = scope === "all" ? runs.map((_, index) => index) : [state.runCursor];
  const matches: GlobalSearchMatch[] = [];
  for (const runIndex of runIndexes) {
    const run = runs[runIndex];
    if (!run) {
      continue;
    }
    for (let sectionIndex = 0; sectionIndex < run.sections.length; sectionIndex += 1) {
      const section = run.sections[sectionIndex];
      const content = renderSectionContent(run, section, state);
      const lines = content.split(/\r?\n/);
      for (let line = 0; line < lines.length; line += 1) {
        if (lines[line].toLowerCase().includes(query)) {
          matches.push({
            runIndex,
            sectionIndex,
            line,
            label: `${compactRunTime(run.startedAt ?? run.runId)} | ${section.title}:${line + 1} | ${truncatePlain(lines[line].trim(), 100)}`
          });
        }
      }
    }
  }
  return matches;
}

function formatGlobalSearchMatch(match: GlobalSearchMatch): string {
  return match.label;
}

interface CompareGroupItem {
  label: string;
  finding?: StructuredFinding;
}

function compareGroupItems(run: ReportRunSummary): CompareGroupItem[] {
  const groups = run.compareGroups;
  if (!groups) {
    return [];
  }
  return [
    ...formatCompareGroup("Added", groups.added),
    ...formatCompareGroup("Changed", groups.changed),
    ...formatCompareGroup("Persisting", groups.persisting),
    ...formatCompareGroup("Resolved", groups.resolved)
  ];
}

function formatCompareGroup(title: string, findings: StructuredFinding[]): CompareGroupItem[] {
  return [
    { label: `${title} (${findings.length})` },
    ...findings.map((finding) => ({
      label: `  ${finding.severity.toUpperCase()} | ${finding.status ?? "open"} | ${finding.id} | ${finding.title}`,
      finding
    }))
  ];
}

interface BookmarkItem {
  label: string;
  kind: "section" | "finding";
  runIndex: number;
  sectionIndex?: number;
  findingId?: string;
  key: string;
}

function bookmarkItems(runs: ReportRunSummary[], state: ReportBrowserState): BookmarkItem[] {
  const sectionMarks = sectionBookmarks(state);
  const findingMarks = findingBookmarks(state);
  const items: BookmarkItem[] = [];
  runs.forEach((run, runIndex) => {
    run.sections.forEach((section, sectionIndex) => {
      const key = sectionBookmarkKey(run, section);
      if (sectionMarks.has(key)) {
        items.push({
          label: `Section | ${compactRunTime(run.startedAt ?? run.runId)} | ${section.title}`,
          kind: "section",
          runIndex,
          sectionIndex,
          key
        });
      }
    });
    run.findings.forEach((finding) => {
      const key = findingBookmarkKey(run, finding);
      if (findingMarks.has(key)) {
        items.push({
          label: `Finding | ${compactRunTime(run.startedAt ?? run.runId)} | ${finding.severity.toUpperCase()} | ${finding.title}`,
          kind: "finding",
          runIndex,
          findingId: finding.id,
          key
        });
      }
    });
  });
  return items;
}

function sectionBookmarks(state: ReportBrowserState): Set<string> {
  state.bookmarkedSections ??= new Set<string>();
  return state.bookmarkedSections;
}

function findingBookmarks(state: ReportBrowserState): Set<string> {
  state.bookmarkedFindings ??= new Set<string>();
  return state.bookmarkedFindings;
}

function sectionBookmarkKey(run: ReportRunSummary, section: ReportSection): string {
  return `${run.runDir}|section|${section.id}`;
}

function findingBookmarkKey(run: ReportRunSummary, finding: StructuredFinding): string {
  return `${run.runDir}|finding|${finding.id}`;
}

function toggleSectionBookmark(run: ReportRunSummary, state: ReportBrowserState): void {
  const section = run.sections[state.sectionCursor];
  if (!section) {
    return;
  }
  const marks = sectionBookmarks(state);
  const key = sectionBookmarkKey(run, section);
  if (marks.has(key)) {
    marks.delete(key);
    state.notice = `Removed bookmark: ${section.title}.`;
  } else {
    marks.add(key);
    state.notice = `Bookmarked section: ${section.title}.`;
  }
}

function toggleFindingBookmark(run: ReportRunSummary, finding: StructuredFinding, state: ReportBrowserState): void {
  const marks = findingBookmarks(state);
  const key = findingBookmarkKey(run, finding);
  if (marks.has(key)) {
    marks.delete(key);
    state.notice = `Removed bookmark: ${finding.id}.`;
  } else {
    marks.add(key);
    state.notice = `Bookmarked finding: ${finding.id}.`;
  }
}

function beginPublish(run: ReportRunSummary, fallbackFinding: StructuredFinding | undefined, state: ReportBrowserState): void {
  if (!run.source) {
    state.notice = "Publishing requires a report generated with --github-repo.";
    return;
  }
  if (fallbackFinding && !queuedFindingsForPublish(run, state).length) {
    queueFindingForPublish(run, fallbackFinding, state, "issue");
  }
  if (!queuedFindingsForPublish(run, state).length) {
    state.notice = "No findings queued for publishing.";
    return;
  }
  state.previousScreen = state.screen;
  state.screen = "confirm-publish";
  state.notice = undefined;
}

function queuedFindingsForPublish(run: ReportRunSummary, state: ReportBrowserState): Array<{ finding: StructuredFinding; target: PublishTarget }> {
  const targets = publishTargets(state);
  const legacyTarget = state.publishTarget;
  const marked = markedFindingIds(state);
  return run.findings.flatMap((finding) => {
    const target = targets[finding.id] ?? (marked.has(finding.id) ? legacyTarget ?? "issue" : undefined);
    return target ? [{ finding, target }] : [];
  });
}

function queueFindingForPublish(run: ReportRunSummary, finding: StructuredFinding, state: ReportBrowserState, target: PublishTarget): void {
  if (!run.source) {
    state.notice = "Publishing requires a report generated with --github-repo.";
    return;
  }
  publishTargets(state)[finding.id] = target;
  markedFindingIds(state).add(finding.id);
  state.notice = `Queued ${finding.id} as ${target}.`;
}

function toggleQueuedFinding(finding: StructuredFinding, state: ReportBrowserState): void {
  const targets = publishTargets(state);
  if (targets[finding.id]) {
    delete targets[finding.id];
    markedFindingIds(state).delete(finding.id);
    state.notice = `Removed from publish queue: ${finding.id}.`;
  } else {
    targets[finding.id] = "issue";
    markedFindingIds(state).add(finding.id);
    state.notice = `Queued ${finding.id} as issue.`;
  }
}

function markedFindingIds(state: ReportBrowserState): Set<string> {
  state.markedFindingIds ??= new Set<string>();
  return state.markedFindingIds;
}

function publishTargets(state: ReportBrowserState): Record<string, PublishTarget> {
  state.publishTargets ??= {};
  return state.publishTargets;
}

function queuedPublishTarget(state: ReportBrowserState, findingId: string): PublishTarget | undefined {
  return publishTargets(state)[findingId] ?? (markedFindingIds(state).has(findingId) ? state.publishTarget ?? "issue" : undefined);
}

async function publishQueuedReportFindings(
  run: ReportRunSummary,
  selections: Array<{ finding: StructuredFinding; target: PublishTarget }>,
  options: AuditOptions,
  projectRoot: string,
  dryRun: boolean
): Promise<string> {
  const outputs: string[] = [];
  for (const target of ["issue", "pr"] as const) {
    const ids = selections.filter((selection) => selection.target === target).map((selection) => selection.finding.id);
    if (!ids.length) {
      continue;
    }
    outputs.push(await runPublishCommand({
      ...options,
      findingRunId: run.runDir,
      findingId: ids.join(","),
      publishTarget: target,
      dryRun
    }, projectRoot));
  }
  return outputs.join("\n");
}

async function syncGithubStatusForReportFindings(
  run: ReportRunSummary,
  findings: StructuredFinding[],
  runs: ReportRunSummary[],
  state: ReportBrowserState,
  options: AuditOptions,
  projectRoot: string
): Promise<void> {
  const ids = findings.map((finding) => finding.id).join(",");
  if (!ids) {
    state.notice = "No findings selected for GitHub status sync.";
    return;
  }
  try {
    const output = await runGithubStatusCommand({
      ...options,
      findingRunId: run.runDir,
      findingId: ids,
      allFindings: false,
      json: false,
      exportFormats: []
    }, projectRoot);
    await reloadReportRuns(runs, run.runDir, state, projectRoot, options);
    state.notice = firstLine(output);
  } catch (error) {
    state.notice = `GitHub status sync failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function reloadReportRuns(
  runs: ReportRunSummary[],
  currentRunDir: string,
  state: ReportBrowserState,
  projectRoot: string,
  options: AuditOptions
): Promise<void> {
  const refreshed = await listReportRuns(projectRoot, options.outDir);
  runs.splice(0, runs.length, ...refreshed);
  const nextRunCursor = refreshed.findIndex((run) => run.runDir === currentRunDir);
  state.runCursor = nextRunCursor >= 0 ? nextRunCursor : clampCursor(state.runCursor, refreshed.length);
}

function removeBookmark(item: BookmarkItem, state: ReportBrowserState): void {
  if (item.kind === "section") {
    sectionBookmarks(state).delete(item.key);
  } else {
    findingBookmarks(state).delete(item.key);
  }
  state.notice = "Bookmark removed.";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function openBookmark(item: BookmarkItem, runs: ReportRunSummary[], state: ReportBrowserState): void {
  state.runCursor = item.runIndex;
  if (item.kind === "section") {
    state.sectionCursor = item.sectionIndex ?? 0;
    state.screen = "viewer";
  } else {
    const run = runs[item.runIndex];
    state.severityFilter = "all";
    state.statusFilter = "all";
    state.publishFilter = "all";
    state.screen = "findings-list";
    if (run && item.findingId) {
      const findings = sortedFilteredFindings(run.findings, state, run);
      state.findingCursor = Math.max(0, findings.findIndex((finding) => finding.id === item.findingId));
    } else {
      state.findingCursor = 0;
    }
  }
  state.scroll = 0;
}

function exportItems(): Array<{ label: string; format: "markdown" | "json" | "html" | "sarif" }> {
  return [
    { label: "Markdown current view", format: "markdown" },
    { label: "JSON current findings", format: "json" },
    { label: "HTML current view", format: "html" },
    { label: "SARIF current findings", format: "sarif" }
  ];
}

async function exportCurrentView(
  run: ReportRunSummary,
  state: ReportBrowserState,
  format: "markdown" | "json" | "html" | "sarif",
): Promise<string> {
  const base = path.join(run.runDir, `tui-export-current.${format === "markdown" ? "md" : format}`);
  if (format === "json") {
    await writeFile(base, JSON.stringify(sortedFilteredFindings(run.findings, state, run), null, 2), "utf8");
    return base;
  }
  if (format === "sarif") {
    await writeFile(base, JSON.stringify(renderSarif(run, sortedFilteredFindings(run.findings, state, run)), null, 2), "utf8");
    return base;
  }
  const content = currentViewMarkdown(run, state);
  if (format === "html") {
    await writeFile(base, renderSimpleHtml(content), "utf8");
    return base;
  }
  await writeFile(base, content, "utf8");
  return base;
}

function currentViewMarkdown(run: ReportRunSummary, state: ReportBrowserState): string {
  const screen = state.screen === "export" ? state.previousScreen : state.screen;
  if (screen === "finding-detail" || screen === "evidence-detail") {
    const finding = currentFinding(run, state);
    if (!finding) {
      return "# Current View\n\nNo finding selected.\n";
    }
    return screen === "evidence-detail"
      ? renderFindingEvidenceDetail(run, finding, state)
      : renderFindingDetail(run, finding, state);
  }
  if (screen === "findings-list") {
    return renderFindingsSection(sortedFilteredFindings(run.findings, state, run), run);
  }
  const section = run.sections[state.sectionCursor];
  return section ? renderSectionContent(run, section, state) : "# Current View\n\nNo section selected.\n";
}

function renderSimpleHtml(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RepoVista TUI Export</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 1100px; line-height: 1.45; }
    pre { white-space: pre-wrap; background: #f6f8fa; padding: 1rem; border-radius: 6px; }
  </style>
</head>
<body><pre>${escaped}</pre></body>
</html>
`;
}

function renderSarif(run: ReportRunSummary, findings: StructuredFinding[]): unknown {
  return {
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "RepoVista" } },
      results: findings.map((finding) => {
        const reference = findingEvidenceReferences(finding)[0];
        return {
          ruleId: finding.id,
          level: finding.severity === "critical" || finding.severity === "high" ? "error" : finding.severity === "medium" ? "warning" : "note",
          message: { text: finding.title },
          locations: reference ? [{
            physicalLocation: {
              artifactLocation: { uri: reference.path },
              region: { startLine: reference.startLine ?? 1, endLine: reference.endLine ?? reference.startLine ?? 1 }
            }
          }] : [],
          properties: {
            status: finding.status ?? "open",
            runId: run.runId,
            recommendation: finding.recommendation
          }
        };
      })
    }]
  };
}

function isTriageKey(key: TuiKey): boolean {
  return ["1", "2", "3", "4", "5"].includes(key.name ?? key.sequence ?? "");
}

function triageStatusForKey(key: TuiKey): FindingStatus {
  const value = key.name ?? key.sequence ?? "1";
  const map: Record<string, FindingStatus> = {
    "1": "open",
    "2": "uncertain",
    "3": "fixed",
    "4": "false-positive",
    "5": "wont-fix"
  };
  return map[value] ?? "open";
}

async function triageFinding(run: ReportRunSummary, finding: StructuredFinding, status: FindingStatus): Promise<void> {
  const now = new Date().toISOString();
  finding.status = status;
  finding.updatedAt = now;
  finding.history = [
    ...(finding.history ?? []),
    {
      runId: run.runId,
      kind: "triage",
      status,
      note: "Updated from repovista reports TUI.",
      commands: ["repovista reports"],
      createdAt: now
    }
  ];
  if (run.meta) {
    run.meta.findings = run.findings;
  }
  await Promise.all([
    writeFile(path.join(run.runDir, "findings.json"), JSON.stringify(run.findings, null, 2), "utf8"),
    run.meta ? writeFile(path.join(run.runDir, "meta.json"), JSON.stringify(run.meta, null, 2), "utf8") : Promise.resolve()
  ]);
}

function openFindingEvidenceInEditor(run: ReportRunSummary, finding: StructuredFinding, state: ReportBrowserState): string {
  const references = findingEvidenceReferences(finding);
  const reference = references[clampCursor(state.evidenceCursor ?? 0, references.length)] ?? references[0];
  if (!reference) {
    return "No evidence reference available.";
  }
  const preview = run.evidencePreviews[evidencePreviewKey(finding, reference)];
  const filePath = preview?.absolutePath ?? path.resolve(run.projectRoot, reference.path);
  const editor = process.env.REPOVISTA_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    return `Set REPOVISTA_EDITOR, VISUAL, or EDITOR to open ${filePath}.`;
  }
  const line = preview?.startLine ?? reference.startLine ?? 1;
  const command = editor.split(/\s+/)[0];
  const args = editor.split(/\s+/).slice(1);
  const commandName = path.basename(command);
  if (commandName === "code" || commandName === "codium" || commandName === "cursor") {
    args.push("-g", `${filePath}:${line}`);
  } else {
    args.push(`+${line}`, filePath);
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
    return `Requested editor for ${filePath}:${line}.`;
  } catch (error) {
    return `Editor failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function nextFindingSort(current: ReportFindingSort): ReportFindingSort {
  const values: ReportFindingSort[] = ["severity", "confidence", "status", "owner", "sla", "path", "first-seen"];
  return values[(values.indexOf(current) + 1) % values.length];
}

function nextLayout(current: ReportLayout): ReportLayout {
  const values: ReportLayout[] = ["normal", "compact", "detailed"];
  return values[(values.indexOf(current) + 1) % values.length];
}

function nextSearchScope(current: ReportSearchScope): ReportSearchScope {
  const values: ReportSearchScope[] = ["run", "all"];
  return values[(values.indexOf(current) + 1) % values.length];
}

function helpLines(screen: ReportBrowserScreen): string[] {
  return [
    "# Keyboard Help",
    "",
    "## Global",
    "",
    "- `?`: show this help",
    "- `g`: global search; Tab toggles run/all scope",
    "- `m`: bookmarks",
    "- `x`: export current view",
    "- `l`: cycle layout preset",
    "- `q` or Ctrl-C: close",
    "",
    "## Runs",
    "",
    "- Enter: open run",
    "- Space: mark report for deletion",
    "- `d`: delete marked reports after confirmation",
    "",
    "## Sections and Report Viewer",
    "",
    "- Enter: open selected section; findings opens the finding list",
    "- `/`: search current section",
    "- `n`: next search hit",
    "- `o`: outline/table of contents",
    "- `h`: report health panel",
    "- `f`: cycle severity filter",
    "- `t`: cycle status filter",
    "- `r`: cycle workflow/readiness filter",
    "- `e`: evidence references",
    "- `c`: grouped compare with previous run",
    "- `b`: bookmark current section",
    "",
    "## Findings",
    "",
    "- Enter: finding detail",
    "- Space: mark finding for GitHub publishing",
    "- `i`: queue finding as GitHub issue",
    "- `p`: queue finding as GitHub pull request",
    "- `g`: refresh linked GitHub status for the selected finding",
    "- `G`: refresh linked GitHub status for all visible findings",
    "- `c`: review queued GitHub publishing",
    "- `s`: cycle finding sort",
    "- `1`: open, `2`: uncertain, `3`: fixed, `4`: false-positive, `5`: wont-fix",
    "- `e`: evidence preview",
    "- `o`: open selected evidence in editor",
    "- `v`: compare groups",
    "- `b`: bookmark finding",
    "",
    `Current screen: ${screen}`
  ];
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

function reportDurationByFile(meta: AuditMeta | undefined): Map<string, number> {
  const durations = new Map<string, number>();
  for (const [fileName, durationMs] of Object.entries(meta?.reportDurations ?? {})) {
    if (isUsableDuration(durationMs)) {
      durations.set(fileName, durationMs);
    }
  }
  for (const phase of meta?.phases ?? []) {
    if (!durations.has(phase.reportFile) && isUsableDuration(phase.durationMs)) {
      durations.set(phase.reportFile, phase.durationMs);
    }
  }
  return durations;
}

function phaseTotalDurationByFile(meta: AuditMeta | undefined): Map<string, number> {
  const durations = new Map<string, number>();
  for (const phase of meta?.phases ?? []) {
    if (isUsableDuration(phase.totalDurationMs)) {
      durations.set(phase.reportFile, phase.totalDurationMs);
    }
  }
  return durations;
}

function runDurationMs(meta: AuditMeta | undefined): number | undefined {
  if (isUsableDuration(meta?.durationMs)) {
    return meta.durationMs;
  }
  const elapsed = elapsedDurationMs(meta?.startedAt, meta?.completedAt);
  if (isUsableDuration(elapsed)) {
    return elapsed;
  }
  if (isUsableDuration(meta?.analytics?.totalDurationMs)) {
    return meta.analytics.totalDurationMs;
  }
  const phaseTotal = (meta?.phases ?? []).reduce((sum, phase) => sum + (isUsableDuration(phase.durationMs) ? phase.durationMs : 0), 0);
  return phaseTotal > 0 ? phaseTotal : undefined;
}

function elapsedDurationMs(startedAt: string | undefined, completedAt: string | undefined): number | undefined {
  const started = parseRunTime(startedAt);
  const completed = parseRunTime(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return undefined;
  }
  return completed - started;
}

function isUsableDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function formatDuration(durationMs: number | undefined): string {
  if (!isUsableDuration(durationMs)) {
    return "duration n/a";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function sectionDurationLabel(section: ReportSection): string {
  const generation = `generation ${formatDuration(section.durationMs)}`;
  if (!isUsableDuration(section.phaseTotalDurationMs)) {
    return generation;
  }
  const generationMs = section.durationMs;
  if (isUsableDuration(generationMs) && Math.abs(section.phaseTotalDurationMs - generationMs) < 1000) {
    return generation;
  }
  return `${generation} | phase total ${formatDuration(section.phaseTotalDurationMs)}`;
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

async function resolveRunDefaultModel(
  provider: string,
  run: { runId: string; runDir: string; displayName?: string },
  options: ReportRunListOptions
): Promise<string | undefined> {
  const resolver = options.defaultModelResolver ?? ((providerId: string) => resolveProviderDefaultModel(providerId));
  return resolver(provider, run);
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

function selectSectionById(run: ReportRunSummary, state: ReportBrowserState, sectionId: string): void {
  const index = run.sections.findIndex((section) => section.id === sectionId);
  if (index >= 0) {
    state.sectionCursor = index;
    state.scroll = 0;
    state.notice = undefined;
  } else {
    state.notice = `Section not available: ${sectionId}.`;
  }
}

function nextSeverityFilter(current: ReportSeverityFilter): ReportSeverityFilter {
  const values: ReportSeverityFilter[] = ["all", "critical", "high", "medium", "low", "unknown"];
  return values[(values.indexOf(current) + 1) % values.length];
}

function nextStatusFilter(current: ReportStatusFilter): ReportStatusFilter {
  const values: ReportStatusFilter[] = ["all", "open", "uncertain", "fixed", "false-positive", "wont-fix"];
  return values[(values.indexOf(current) + 1) % values.length];
}

function handleSearchInput(state: ReportBrowserState, key: TuiKey): void {
  if (key.name === "escape") {
    state.searchMode = false;
    state.searchInput = undefined;
    return;
  }
  if (key.name === "return" || key.name === "enter") {
    state.searchMode = false;
    state.searchQuery = state.searchInput?.trim() || undefined;
    state.searchMatchIndex = 0;
    state.searchInput = undefined;
    return;
  }
  if (key.name === "backspace") {
    state.searchInput = (state.searchInput ?? "").slice(0, -1);
    return;
  }
  const value = key.sequence ?? "";
  if (value.length === 1 && value >= " " && value !== "\x7f") {
    state.searchInput = `${state.searchInput ?? ""}${value}`;
  }
}

function firstSearchMatchScroll(content: string, query: string, index: number): number {
  const matches = searchMatchScrolls(content, query);
  if (!matches.length) {
    return 0;
  }
  return matches[Math.max(0, Math.min(index, matches.length - 1))];
}

function searchMatchScrolls(content: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return content
    .split(/\r?\n/)
    .map((line, index) => line.toLowerCase().includes(needle) ? index : -1)
    .filter((index) => index >= 0);
}

function findingEvidenceReferences(finding: StructuredFinding): FindingEvidenceReference[] {
  if (finding.evidenceDetails?.length) {
    return finding.evidenceDetails;
  }
  if (finding.evidenceReferences?.length) {
    return finding.evidenceReferences.map((reference) => typeof reference === "string" ? { path: reference } : reference);
  }
  return finding.paths.map((item) => ({ path: item }));
}

function renderEvidenceReferences(references: FindingEvidenceReference[]): string[] {
  return references.map((reference) => `${formatEvidenceReference(reference)}${reference.quote ? ` (${reference.quote})` : ""}`);
}

function formatEvidenceReference(reference: FindingEvidenceReference): string {
  const range = reference.startLine
    ? `:${reference.startLine}${reference.endLine && reference.endLine !== reference.startLine ? `-${reference.endLine}` : ""}`
    : "";
  return `${reference.path}${range}`;
}

function findingSearchText(finding: StructuredFinding): string {
  return [
    finding.id,
    finding.title,
    finding.severity,
    finding.status,
    finding.category,
    finding.owner,
    finding.labels?.join(" "),
    finding.paths.join(" "),
    finding.evidence,
    finding.recommendation,
    finding.problemRationale,
    finding.issue?.url
  ].filter(Boolean).join(" ").toLowerCase();
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

function creationTime(run: ReportRunSummary): number {
  const parsed = parseRunTime(run.startedAt ?? run.runId ?? run.completedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRunTime(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const runId = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!runId) {
    return Number.NaN;
  }
  return Date.parse(`${runId[1]}T${runId[2]}:${runId[3]}:${runId[4]}.${runId[5]}Z`);
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
