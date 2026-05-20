import { lstat, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ReadStream, WriteStream } from "node:tty";
import { runCompareCommand } from "./compare.js";
import { resolveProviderDefaultModel } from "./provider-models.js";
import { validateReportRoot } from "./reports.js";
import {
  renderTuiListFrame,
  renderTuiTextFrame,
  runTuiSession,
  shouldUseColor,
  wrappedLineCount,
  type TuiKey
} from "./tui.js";
import type { AuditMeta, AuditOptions, FindingEvidenceReference, FindingStatus, StructuredFinding } from "./types.js";

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
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  provider?: string;
  model?: string;
  reasoning?: string;
  findingCount: number;
  exitCode?: number;
  findings: StructuredFinding[];
  sections: ReportSection[];
}

export interface ReportSection {
  id: string;
  title: string;
  fileName?: string;
  content: string;
  durationMs?: number;
  phaseTotalDurationMs?: number;
}

export type ReportBrowserScreen = "runs" | "sections" | "viewer" | "confirm-delete";
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
  severityFilter?: ReportSeverityFilter;
  statusFilter?: ReportStatusFilter;
}

export type ReportSeverityFilter = "all" | StructuredFinding["severity"];
export type ReportStatusFilter = "all" | FindingStatus;

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
      await handleReportBrowserKey(runs, state, key, output.rows ?? 30, output.columns ?? 100, shouldUseColor(output));
      if ((key.ctrl && key.name === "c") || key.name === "q") {
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
    severityFilter: "all",
    statusFilter: "all"
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
    .map(async (entry) => loadReportRun(path.join(outRoot, entry.name), entry.name, options)));
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
    const content = renderSectionContent(run, section, state);
    return renderTuiTextFrame({
      title: "RepoVista Reports",
      help: state.searchMode
        ? "Type search | Enter applies | Esc cancels | Backspace deletes"
        : "Up/Down scroll | / search | n next | f severity | t status | e evidence | Esc returns | q exits",
      sectionTitle: `${run.runId} / ${section.title}`,
      lines: content.split(/\r?\n/),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: formatViewerFooter(section, state)
    });
  }

  if (state.screen === "sections" && run) {
    return renderTuiListFrame({
      title: "RepoVista Reports",
      help: "Up/Down move | Enter opens | f severity | t status | e evidence | c compare | Esc returns | q exits",
      sectionTitle: `${run.runId} sections`,
      items: run.sections.map(formatSectionItem),
      cursor: state.sectionCursor,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No report sections found.",
      footer: `${Math.min(state.sectionCursor + 1, run.sections.length)}/${run.sections.length} | ${filterLabel(state)} | ${run.runDir}`
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

async function handleReportBrowserKey(runs: ReportRunSummary[], state: ReportBrowserState, key: TuiKey, rows: number, columns: number, color: boolean): Promise<void> {
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
    } else if (key.name === "f") {
      state.severityFilter = nextSeverityFilter(state.severityFilter ?? "all");
      selectSectionById(run, state, "findings");
    } else if (key.name === "t") {
      state.statusFilter = nextStatusFilter(state.statusFilter ?? "all");
      selectSectionById(run, state, "findings");
    } else if (key.name === "e") {
      selectSectionById(run, state, "evidence-refs");
    } else if (key.name === "c") {
      selectSectionById(run, state, "compare-previous");
    } else if (key.name === "return" || key.name === "enter" || key.name === "right") {
      state.screen = "viewer";
      state.scroll = 0;
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
    } else if (key.name === "e") {
      selectSectionById(run, state, "evidence-refs");
      state.screen = "viewer";
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

async function loadReportRun(runDir: string, fallbackRunId: string, options: ReportRunListOptions): Promise<ReportRunSummary | undefined> {
  const marker = await hasRunMarker(runDir);
  if (!marker) {
    return undefined;
  }
  const [meta, findings] = await Promise.all([
    readJson<AuditMeta>(path.join(runDir, "meta.json")),
    readJson<StructuredFinding[]>(path.join(runDir, "findings.json"))
  ]);
  const normalizedFindings = findings ?? meta?.findings ?? [];
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
    startedAt: meta?.startedAt,
    completedAt: meta?.completedAt,
    durationMs,
    provider: displayName ?? providerId,
    model: resolvedModel,
    reasoning: cleanReasoningLabel(meta?.ai?.reasoning ?? meta?.codex?.reasoning),
    findingCount: normalizedFindings.length || countFindings(meta?.findingCounts),
    exitCode: meta?.exitCode,
    findings: normalizedFindings,
    sections
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
  if (section.id === "findings") {
    return renderFindingsSection(filteredFindings(run.findings, state));
  }
  if (section.id === "evidence-refs") {
    return renderEvidenceRefsSection(filteredFindings(run.findings, state));
  }
  return section.content;
}

function filteredFindings(findings: StructuredFinding[], state: ReportBrowserState): StructuredFinding[] {
  const severity = state.severityFilter ?? "all";
  const status = state.statusFilter ?? "all";
  const query = state.searchQuery?.trim().toLowerCase();
  return findings.filter((finding) =>
    (severity === "all" || finding.severity === severity) &&
    (status === "all" || (finding.status ?? "open") === status) &&
    (!query || findingSearchText(finding).includes(query))
  );
}

function renderFindingsSection(findings: StructuredFinding[]): string {
  if (!findings.length) {
    return "# Findings\n\nNo findings match the current filters.\n";
  }
  return `# Findings\n\n${findings.map((finding, index) => [
    `## ${index + 1}. ${finding.severity.toUpperCase()}: ${finding.title}`,
    "",
    `- ID: ${finding.id}`,
    `- Status: ${finding.status ?? "open"}`,
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
  ].join("\n")).join("\n\n")}\n`;
}

function renderEvidenceRefsSection(findings: StructuredFinding[]): string {
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
    reference.quote ? `- Quote: ${reference.quote}` : undefined
  ].filter(Boolean).join("\n")).join("\n\n")}\n`;
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
  const model = `model: ${run.model ?? "default"}`;
  const reasoning = `reasoning: ${run.reasoning ?? "default"}`;
  const exit = run.exitCode === undefined ? "exit n/a" : `exit ${run.exitCode}`;
  return `${marked ? "[x]" : "[ ]"} ${when} | ${model} | ${reasoning} | ${run.findingCount} finding(s) | ${exit} | total ${formatDuration(run.durationMs)}`;
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

function formatViewerFooter(section: ReportSection, state: ReportBrowserState): string {
  const parts = [
    section.fileName ?? "combined",
    `${state.scroll + 1}+`,
    filterLabel(state),
    state.searchMode ? `search: ${state.searchInput ?? ""}` : state.searchQuery ? `search: ${state.searchQuery}` : undefined
  ];
  return parts.filter(Boolean).join(" | ");
}

function filterLabel(state: ReportBrowserState): string {
  return `severity ${state.severityFilter ?? "all"} | status ${state.statusFilter ?? "all"}`;
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
