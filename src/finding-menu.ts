import type { ReadStream, WriteStream } from "node:tty";
import { loadStoredFindings, rewriteFindingStateAtomic } from "./finding-store.js";
import {
  findingPublishReadiness,
  findingQueueMarker,
  findingWorkflowFilterLabel,
  matchesFindingWorkflowFilter,
  nextFindingWorkflowFilter,
  renderStructuredFindingDetail,
  statusCycleLabel,
  type FindingWorkflowFilter
} from "./finding-view.js";
import { runPublishCommand } from "./publish.js";
import { listReportRuns, type ReportRunSummary } from "./report-browser.js";
import { renderTuiListFrame, renderTuiTextFrame, runTuiSession, shouldUseColor, wrappedLineCount, type TuiKey } from "./tui.js";
import type { AuditOptions, FindingStatus, PublishTarget, StructuredFinding } from "./types.js";

const STATUS_KEYS: Record<string, FindingStatus> = {
  "1": "open",
  "2": "uncertain",
  "3": "fixed",
  "4": "false-positive",
  "5": "wont-fix",
  o: "open",
  f: "fixed",
  w: "wont-fix",
  u: "uncertain"
};

export type FindingsMenuScreen = "list" | "detail" | "board" | "confirm-publish" | "publish-output" | "select-run";

export interface FindingPublishRunChoice {
  runId: string;
  runDir: string;
  repository: string;
  sourceLabel: string;
}

export interface FindingsMenuState {
  cursor: number;
  detail: boolean;
  board: boolean;
  screen?: FindingsMenuScreen;
  scroll: number;
  severityFilter: "all" | StructuredFinding["severity"];
  statusFilter?: "all" | FindingStatus;
  workflowFilter?: FindingWorkflowFilter;
  publishRuns?: Record<string, FindingPublishRunChoice[]>;
  publishTargets?: Record<string, PublishTarget>;
  selectedRunDirs?: Record<string, string>;
  runChoiceFindingId?: string;
  runChoiceCursor?: number;
  publishOutput?: string;
  issueLabels?: string[];
  issueAssignees?: string[];
  notice?: string;
}

export async function runFindingsMenu(
  options: AuditOptions,
  input = process.stdin as ReadStream,
  output = process.stdout as WriteStream,
  projectRoot = process.cwd(),
  now = new Date()
): Promise<string> {
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  if (!findings.length) {
    return "No RepoVista findings found.\n";
  }
  const runs = await listReportRuns(projectRoot, options.outDir);

  const state: FindingsMenuState = {
    cursor: 0,
    detail: false,
    board: false,
    screen: "list",
    scroll: 0,
    severityFilter: "all",
    statusFilter: "all",
    workflowFilter: "all",
    publishRuns: buildFindingPublishRuns(runs),
    publishTargets: {},
    selectedRunDirs: {},
    issueLabels: options.issueLabels ?? [],
    issueAssignees: options.issueAssignees ?? []
  };
  let dirty = false;

  return runTuiSession({
    input,
    output,
    notInteractiveMessage: "The findings-ui command requires an interactive terminal.",
    notInteractiveCode: "FINDINGS_UI_NOT_INTERACTIVE",
    render: () => renderFindingsMenuFrame(findings, state, {
      columns: output.columns ?? 100,
      rows: output.rows ?? 30,
      color: shouldUseColor(output)
    }),
    onKey: async (key, controls) => {
      const updated = await handleFindingsMenuKey(findings, state, key, {
        options,
        projectRoot,
        now,
        rows: output.rows ?? 30,
        columns: output.columns ?? 100,
        color: shouldUseColor(output),
        reload: async () => {
          const [freshFindings, freshRuns] = await Promise.all([
            loadStoredFindings(projectRoot, options.outDir),
            listReportRuns(projectRoot, options.outDir)
          ]);
          findings.splice(0, findings.length, ...freshFindings);
          state.publishRuns = buildFindingPublishRuns(freshRuns);
          state.cursor = clampCursor(state.cursor, filterFindings(findings, state).length);
        },
        saveIfDirty: async () => {
          if (dirty) {
            await rewriteFindingStateAtomic(projectRoot, options.outDir, findings);
            dirty = false;
          }
        }
      });
      dirty = dirty || updated;
      if ((key.ctrl && key.name === "c") || key.name === "q") {
        controls.finish();
      }
    },
    onFinish: async () => {
      if (dirty) {
        await rewriteFindingStateAtomic(projectRoot, options.outDir, findings);
      }
      return dirty ? "\nSaved RepoVista finding state.\n" : "\nFinding state unchanged.\n";
    }
  });
}

export function renderFindingsMenuFrame(
  findings: StructuredFinding[],
  state: FindingsMenuState,
  options: { columns: number; rows: number; color: boolean }
): string {
  const screen = activeScreen(state);
  const visibleFindings = filterFindings(findings, state);
  const finding = visibleFindings[state.cursor];

  if (screen === "select-run") {
    const current = state.runChoiceFindingId ? findings.find((item) => item.id === state.runChoiceFindingId) : undefined;
    const choices = current ? publishRunsFor(current, state) : [];
    return renderTuiListFrame({
      title: "RepoVista Findings",
      help: "Enter selects run | Up/Down move | Esc cancels | q exits",
      sectionTitle: current ? `Select GitHub source run for ${current.id}` : "Select GitHub source run",
      items: choices.map((choice) => `${choice.repository} | ${choice.runId} | ${choice.sourceLabel}`),
      cursor: state.runChoiceCursor ?? 0,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No GitHub-source runs found for this finding.",
      footer: state.notice
    });
  }

  if (screen === "confirm-publish") {
    const selections = queuedFindingsForPublish(findings, state);
    return renderTuiListFrame({
      title: "RepoVista Findings",
      help: "Enter publishes | d dry-run preview | Esc cancels | q exits",
      sectionTitle: `Publish ${selections.length} queued finding(s)`,
      items: selections.map(({ finding: item, target, run }) => `${target.toUpperCase()} | ${item.severity.toUpperCase()} | ${item.id} | ${run?.repository ?? "no github source"} | ${labelsForPublish(item, state)} | ${item.title}`),
      cursor: -1,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      emptyMessage: "No findings queued. Use Space, i, or p from the list.",
      footer: `${state.notice ?? ""} | d previews all queued groups`
    });
  }

  if (screen === "publish-output") {
    return renderTuiTextFrame({
      title: "RepoVista Publish",
      help: "Esc returns | Enter returns | q exits",
      sectionTitle: "Publish Output",
      lines: (state.publishOutput ?? "No publish output.").split(/\r?\n/),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: state.notice
    });
  }

  if (screen === "board") {
    return renderTuiTextFrame({
      title: "RepoVista Findings",
      help: "b returns to list | s/t/r filters | q exits",
      sectionTitle: `Triage board / ${filterFooter(state)}`,
      lines: triageBoardLines(visibleFindings),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: `${visibleFindings.length}/${findings.length} finding(s) | queued ${queuedFindingsForPublish(findings, state).length}${state.notice ? ` | ${state.notice}` : ""}`
    });
  }

  if (screen === "detail" && finding) {
    return renderTuiTextFrame({
      title: "RepoVista Findings",
      help: "Up/Down scroll | Space queue | i issue | p PR | c publish | 1-5 triage | Enter/Esc returns",
      sectionTitle: `${finding.id} / ${finding.status ?? "open"}`,
      lines: renderStructuredFindingDetail(finding, {
        layout: "detailed",
        publishable: publishRunsFor(finding, state).length > 0,
        sourceLabel: selectedPublishRun(finding, state)?.sourceLabel,
        queueTarget: queuedPublishTarget(state, finding.id)
      }),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: `${state.cursor + 1}/${visibleFindings.length} | ${filterFooter(state)} | queued ${queuedFindingsForPublish(findings, state).length}${state.notice ? ` | ${state.notice}` : ""}`
    });
  }

  return renderTuiListFrame({
    title: "RepoVista Findings",
    help: "Up/Down move | Enter detail | Space queue | i issue | p PR | 0 skip | c publish | 1-5 triage | s/t/r filters",
    sectionTitle: "Persisted findings",
    items: visibleFindings.map((item) => formatFindingItem(item, state)),
    cursor: state.cursor,
    columns: options.columns,
    rows: options.rows,
    color: options.color,
    emptyMessage: "No RepoVista findings match the current filters.",
    footer: `${visibleFindings.length}/${findings.length} | ${filterFooter(state)} | queued ${queuedFindingsForPublish(findings, state).length}${state.notice ? ` | ${state.notice}` : ""}`
  });
}

interface HandleFindingsMenuContext {
  options: AuditOptions;
  projectRoot: string;
  now: Date;
  rows: number;
  columns: number;
  color: boolean;
  reload(): Promise<void>;
  saveIfDirty(): Promise<void>;
}

async function handleFindingsMenuKey(
  findings: StructuredFinding[],
  state: FindingsMenuState,
  key: TuiKey,
  context: HandleFindingsMenuContext
): Promise<boolean> {
  if ((key.ctrl && key.name === "c") || key.name === "q") {
    return false;
  }

  const screen = activeScreen(state);
  if (screen === "publish-output") {
    if (key.name === "escape" || key.name === "backspace" || key.name === "left" || key.name === "return" || key.name === "enter") {
      setScreen(state, "list");
      state.scroll = 0;
    } else {
      scrollText(state, key, context.rows, context.columns, context.color, (state.publishOutput ?? "").split(/\r?\n/));
    }
    return false;
  }

  if (screen === "select-run") {
    const current = state.runChoiceFindingId ? findings.find((item) => item.id === state.runChoiceFindingId) : undefined;
    const choices = current ? publishRunsFor(current, state) : [];
    if (key.name === "escape" || key.name === "backspace" || key.name === "left") {
      setScreen(state, "list");
      state.notice = "Publish cancelled.";
    } else if (key.name === "up") {
      state.runChoiceCursor = wrapIndex((state.runChoiceCursor ?? 0) - 1, choices.length);
    } else if (key.name === "down") {
      state.runChoiceCursor = wrapIndex((state.runChoiceCursor ?? 0) + 1, choices.length);
    } else if ((key.name === "return" || key.name === "enter" || key.name === "right") && current && choices.length) {
      const choice = choices[clampCursor(state.runChoiceCursor ?? 0, choices.length)];
      selectedRunDirs(state)[current.id] = choice.runDir;
      const next = nextFindingNeedingRunChoice(findings, state);
      if (next) {
        state.runChoiceFindingId = next.id;
        state.runChoiceCursor = 0;
      } else {
        setScreen(state, "confirm-publish");
      }
    }
    return false;
  }

  if (screen === "confirm-publish") {
    if (key.name === "escape" || key.name === "backspace" || key.name === "left") {
      setScreen(state, "list");
      state.notice = "Publish cancelled.";
      return false;
    }
    if (key.name === "d" || key.name === "return" || key.name === "enter") {
      const dryRun = key.name === "d";
      try {
        await context.saveIfDirty();
        const output = await publishQueuedFindings(findings, state, context.options, context.projectRoot, dryRun);
        if (!dryRun) {
          state.publishTargets = {};
          state.selectedRunDirs = {};
          await context.reload();
        }
        state.publishOutput = output;
        state.notice = dryRun ? "Dry-run preview generated." : firstLine(output);
        setScreen(state, "publish-output");
      } catch (error) {
        state.notice = `Publish failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      return false;
    }
    return false;
  }

  if (key.name === "b") {
    setScreen(state, screen === "board" ? "list" : "board");
    state.scroll = 0;
    state.cursor = clampCursor(state.cursor, filterFindings(findings, state).length);
    return false;
  }
  if (key.name === "s" && screen !== "detail") {
    state.severityFilter = nextSeverityFilter(state.severityFilter);
    state.cursor = clampCursor(state.cursor, filterFindings(findings, state).length);
    state.scroll = 0;
    return false;
  }
  if (key.name === "t" && screen !== "detail") {
    state.statusFilter = nextStatusFilter(state.statusFilter ?? "all");
    state.cursor = clampCursor(state.cursor, filterFindings(findings, state).length);
    state.scroll = 0;
    return false;
  }
  if (key.name === "r" && screen !== "detail") {
    state.workflowFilter = nextFindingWorkflowFilter(state.workflowFilter);
    state.cursor = clampCursor(state.cursor, filterFindings(findings, state).length);
    state.scroll = 0;
    return false;
  }
  if (screen === "board") {
    return handleBoardScroll(findings, state, key, context.rows, context.columns, context.color);
  }

  const visibleFindings = filterFindings(findings, state);
  const finding = visibleFindings[clampCursor(state.cursor, visibleFindings.length)];
  if (key.name && STATUS_KEYS[key.name]) {
    if (!finding) {
      return false;
    }
    const status = STATUS_KEYS[key.name];
    finding.status = status;
    finding.updatedAt = context.now.toISOString();
    finding.history = [
      ...(finding.history ?? []),
      {
        kind: "triage",
        status,
        note: "Updated from findings-ui.",
        commands: [],
        createdAt: context.now.toISOString()
      }
    ];
    state.notice = `Status set to ${status}.`;
    return true;
  }
  if (key.name === "space" && finding) {
    toggleQueuedFinding(finding, state);
    return false;
  }
  if ((key.name === "i" || key.name === "p") && finding) {
    queueFindingForPublish(finding, state, key.name === "p" ? "pr" : "issue");
    return false;
  }
  if ((key.name === "0" || key.name === "delete") && finding) {
    removeFromPublishQueue(finding, state);
    return false;
  }
  if (key.name === "c") {
    beginPublish(findings, state);
    return false;
  }

  if (screen === "detail") {
    const lines = finding ? renderStructuredFindingDetail(finding, {
      layout: "detailed",
      publishable: publishRunsFor(finding, state).length > 0,
      sourceLabel: selectedPublishRun(finding, state)?.sourceLabel,
      queueTarget: queuedPublishTarget(state, finding.id)
    }) : [];
    if (key.name === "escape" || key.name === "backspace" || key.name === "left" || key.name === "return" || key.name === "enter") {
      setScreen(state, "list");
      state.scroll = 0;
    } else {
      scrollText(state, key, context.rows, context.columns, context.color, lines);
    }
    return false;
  }

  if (key.name === "up") {
    state.cursor = wrapIndex(state.cursor - 1, visibleFindings.length);
  } else if (key.name === "down") {
    state.cursor = wrapIndex(state.cursor + 1, visibleFindings.length);
  } else if (key.name === "return" || key.name === "enter" || key.name === "right") {
    setScreen(state, "detail");
    state.scroll = 0;
  }
  return false;
}

function formatFindingItem(finding: StructuredFinding, state: FindingsMenuState): string {
  const owner = finding.owner ? ` owner:${finding.owner}` : "";
  const sla = finding.sla?.overdue ? " SLA:overdue" : finding.sla ? ` SLA:${finding.sla.dueAt.slice(0, 10)}` : "";
  const publishable = publishRunsFor(finding, state).length > 0;
  const run = selectedPublishRun(finding, state);
  return `[${findingQueueMarker(queuedPublishTarget(state, finding.id))}] ${finding.severity.toUpperCase().padEnd(8)} ${(finding.status ?? "open").padEnd(14)} ${finding.id} ${finding.title}${owner}${sla} | ${findingPublishReadiness(finding, publishable)}${run ? ` | ${run.repository}` : ""}`;
}

function triageBoardLines(findings: StructuredFinding[]): string[] {
  const statuses: FindingStatus[] = ["open", "uncertain", "fixed", "false-positive", "wont-fix"];
  const lines = ["# Triage Board", ""];
  for (const status of statuses) {
    const group = findings.filter((finding) => (finding.status ?? "open") === status).sort(compareBoardFindings);
    lines.push(`## ${status} (${group.length})`, "");
    if (!group.length) {
      lines.push("- n/a", "");
      continue;
    }
    for (const finding of group) {
      const owner = finding.owner ? ` | owner ${finding.owner}` : "";
      const labels = finding.labels?.length ? ` | labels ${finding.labels.join(", ")}` : "";
      const sla = finding.sla ? ` | SLA ${finding.sla.dueAt.slice(0, 10)}${finding.sla.overdue ? " overdue" : ""}` : "";
      lines.push(`- ${finding.severity.toUpperCase()} ${finding.id}: ${finding.title}${owner}${labels}${sla}`);
    }
    lines.push("");
  }
  return lines;
}

function filterFindings(findings: StructuredFinding[], state: FindingsMenuState): StructuredFinding[] {
  return findings.filter((finding) =>
    (state.severityFilter === "all" || finding.severity === state.severityFilter) &&
    ((state.statusFilter ?? "all") === "all" || (finding.status ?? "open") === state.statusFilter) &&
    matchesFindingWorkflowFilter(finding, state.workflowFilter, { publishable: publishRunsFor(finding, state).length > 0 })
  );
}

function nextSeverityFilter(current: FindingsMenuState["severityFilter"]): FindingsMenuState["severityFilter"] {
  const values: FindingsMenuState["severityFilter"][] = ["all", "critical", "high", "medium", "low", "unknown"];
  return values[(values.indexOf(current) + 1) % values.length];
}

function nextStatusFilter(current: "all" | FindingStatus): "all" | FindingStatus {
  const values: Array<"all" | FindingStatus> = ["all", "open", "uncertain", "fixed", "false-positive", "wont-fix"];
  return values[(values.indexOf(current) + 1) % values.length];
}

function handleBoardScroll(
  findings: StructuredFinding[],
  state: FindingsMenuState,
  key: TuiKey,
  rows: number,
  columns: number,
  color: boolean
): boolean {
  scrollText(state, key, rows, columns, color, triageBoardLines(filterFindings(findings, state)));
  return false;
}

function scrollText(state: FindingsMenuState, key: TuiKey, rows: number, columns: number, color: boolean, lines: string[]): void {
  const lineCount = wrappedLineCount(lines, columns, color);
  const page = Math.max(4, rows - 8);
  const maxScroll = Math.max(0, lineCount - page);
  if (key.name === "up") {
    state.scroll = Math.max(0, state.scroll - 1);
  } else if (key.name === "down") {
    state.scroll = Math.min(maxScroll, state.scroll + 1);
  } else if (key.name === "pageup") {
    state.scroll = Math.max(0, state.scroll - page);
  } else if (key.name === "pagedown") {
    state.scroll = Math.min(maxScroll, state.scroll + page);
  } else if (key.name === "home") {
    state.scroll = 0;
  } else if (key.name === "end") {
    state.scroll = maxScroll;
  }
}

function buildFindingPublishRuns(runs: ReportRunSummary[]): Record<string, FindingPublishRunChoice[]> {
  const index: Record<string, FindingPublishRunChoice[]> = {};
  for (const run of runs) {
    if (!run.source) {
      continue;
    }
    for (const finding of run.findings) {
      index[finding.id] ??= [];
      index[finding.id].push({
        runId: run.runId,
        runDir: run.runDir,
        repository: run.source.repository,
        sourceLabel: `${run.source.repository}@${run.source.ref ?? run.source.defaultBranch ?? run.source.commit.slice(0, 12)}`
      });
    }
  }
  return index;
}

function publishRunsFor(finding: StructuredFinding, state: FindingsMenuState): FindingPublishRunChoice[] {
  return state.publishRuns?.[finding.id] ?? [];
}

function selectedPublishRun(finding: StructuredFinding, state: FindingsMenuState): FindingPublishRunChoice | undefined {
  const runs = publishRunsFor(finding, state);
  const selectedRunDir = selectedRunDirs(state)[finding.id];
  if (selectedRunDir) {
    return runs.find((run) => run.runDir === selectedRunDir);
  }
  return runs.length === 1 ? runs[0] : undefined;
}

function publishTargets(state: FindingsMenuState): Record<string, PublishTarget> {
  state.publishTargets ??= {};
  return state.publishTargets;
}

function selectedRunDirs(state: FindingsMenuState): Record<string, string> {
  state.selectedRunDirs ??= {};
  return state.selectedRunDirs;
}

function queuedPublishTarget(state: FindingsMenuState, findingId: string): PublishTarget | undefined {
  return publishTargets(state)[findingId];
}

function queuedFindingsForPublish(findings: StructuredFinding[], state: FindingsMenuState): Array<{ finding: StructuredFinding; target: PublishTarget; run?: FindingPublishRunChoice }> {
  const targets = publishTargets(state);
  return findings.flatMap((finding) => {
    const target = targets[finding.id];
    if (!target) {
      return [];
    }
    return [{ finding, target, run: selectedPublishRun(finding, state) }];
  });
}

function queueFindingForPublish(finding: StructuredFinding, state: FindingsMenuState, target: PublishTarget): void {
  publishTargets(state)[finding.id] = target;
  state.notice = `Queued ${finding.id} as ${target}.`;
}

function toggleQueuedFinding(finding: StructuredFinding, state: FindingsMenuState): void {
  if (queuedPublishTarget(state, finding.id)) {
    removeFromPublishQueue(finding, state);
  } else {
    queueFindingForPublish(finding, state, "issue");
  }
}

function removeFromPublishQueue(finding: StructuredFinding, state: FindingsMenuState): void {
  delete publishTargets(state)[finding.id];
  delete selectedRunDirs(state)[finding.id];
  state.notice = `Skipped ${finding.id}.`;
}

function beginPublish(findings: StructuredFinding[], state: FindingsMenuState): void {
  const selections = queuedFindingsForPublish(findings, state);
  if (!selections.length) {
    const finding = filterFindings(findings, state)[state.cursor];
    if (finding) {
      queueFindingForPublish(finding, state, "issue");
    }
  }
  const missingSource = queuedFindingsForPublish(findings, state).find((selection) => !publishRunsFor(selection.finding, state).length);
  if (missingSource) {
    state.notice = `${missingSource.finding.id} has no GitHub-source report.`;
    return;
  }
  const nextChoice = nextFindingNeedingRunChoice(findings, state);
  if (nextChoice) {
    state.runChoiceFindingId = nextChoice.id;
    state.runChoiceCursor = 0;
    setScreen(state, "select-run");
    return;
  }
  setScreen(state, "confirm-publish");
  state.notice = undefined;
}

function nextFindingNeedingRunChoice(findings: StructuredFinding[], state: FindingsMenuState): StructuredFinding | undefined {
  return queuedFindingsForPublish(findings, state)
    .map((selection) => selection.finding)
    .find((finding) => publishRunsFor(finding, state).length > 1 && !selectedRunDirs(state)[finding.id]);
}

async function publishQueuedFindings(
  findings: StructuredFinding[],
  state: FindingsMenuState,
  options: AuditOptions,
  projectRoot: string,
  dryRun: boolean
): Promise<string> {
  const selections = queuedFindingsForPublish(findings, state);
  const missing = selections.find((selection) => !selection.run);
  if (missing) {
    throw new Error(`Finding ${missing.finding.id} has no selected GitHub-source run.`);
  }

  const groups = new Map<string, { run: FindingPublishRunChoice; target: PublishTarget; ids: string[] }>();
  for (const selection of selections) {
    const run = selection.run as FindingPublishRunChoice;
    const key = `${run.runDir}\0${selection.target}`;
    const group = groups.get(key) ?? { run, target: selection.target, ids: [] };
    group.ids.push(selection.finding.id);
    groups.set(key, group);
  }

  const outputs: string[] = [];
  for (const group of groups.values()) {
    outputs.push(await runPublishCommand({
      ...options,
      findingRunId: group.run.runDir,
      findingId: group.ids.join(","),
      publishTarget: group.target,
      dryRun
    }, projectRoot));
  }
  return outputs.join("\n");
}

function labelsForPublish(finding: StructuredFinding, state: FindingsMenuState): string {
  const labels = Array.from(new Set([...(finding.labels ?? []), ...(state.issueLabels ?? [])])).sort();
  return `labels ${labels.join(", ") || "n/a"} | assignees ${(state.issueAssignees ?? []).join(", ") || "n/a"}`;
}

function filterFooter(state: FindingsMenuState): string {
  return [
    `severity ${state.severityFilter}`,
    statusCycleLabel(state.statusFilter ?? "all"),
    findingWorkflowFilterLabel(state.workflowFilter)
  ].join(" | ");
}

function activeScreen(state: FindingsMenuState): FindingsMenuScreen {
  if (state.screen) {
    return state.screen;
  }
  if (state.board) {
    return "board";
  }
  return state.detail ? "detail" : "list";
}

function setScreen(state: FindingsMenuState, screen: FindingsMenuScreen): void {
  state.screen = screen;
  state.board = screen === "board";
  state.detail = screen === "detail";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function compareBoardFindings(left: StructuredFinding, right: StructuredFinding): number {
  return severityRank(right.severity) - severityRank(left.severity) ||
    Number(Boolean(right.sla?.overdue)) - Number(Boolean(left.sla?.overdue)) ||
    left.title.localeCompare(right.title);
}

function severityRank(value: StructuredFinding["severity"]): number {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    unknown: 0
  }[value] ?? 0;
}

function clampCursor(cursor: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, cursor), length - 1);
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}
