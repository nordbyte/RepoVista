import type { ReadStream, WriteStream } from "node:tty";
import { loadStoredFindings, rewriteFindingStateAtomic } from "./finding-store.js";
import { renderTuiListFrame, renderTuiTextFrame, runTuiSession, shouldUseColor, wrappedLineCount, type TuiKey } from "./tui.js";
import type { AuditOptions, FindingStatus, StructuredFinding } from "./types.js";

const STATUS_KEYS: Record<string, FindingStatus> = {
  o: "open",
  f: "fixed",
  p: "false-positive",
  w: "wont-fix",
  u: "uncertain"
};

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

  const state = {
    cursor: 0,
    detail: false,
    scroll: 0
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
    onKey: (key, controls) => {
      const updated = handleFindingsMenuKey(findings, state, key, now, output.rows ?? 30, output.columns ?? 100);
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
  state: { cursor: number; detail: boolean; scroll: number },
  options: { columns: number; rows: number; color: boolean }
): string {
  const finding = findings[state.cursor];
  if (state.detail && finding) {
    return renderTuiTextFrame({
      title: "RepoVista Findings",
      help: "Up/Down scroll | Enter/Esc returns | o/f/p/w/u sets status | q exits",
      sectionTitle: `${finding.id} / ${finding.status ?? "open"}`,
      lines: findingDetailLines(finding),
      scroll: state.scroll,
      columns: options.columns,
      rows: options.rows,
      color: options.color,
      footer: `${state.cursor + 1}/${findings.length}`
    });
  }

  return renderTuiListFrame({
    title: "RepoVista Findings",
    help: "Up/Down move | Enter opens detail | o/f/p/w/u sets status | q exits",
    sectionTitle: "Persisted findings",
    items: findings.map(formatFindingItem),
    cursor: state.cursor,
    columns: options.columns,
    rows: options.rows,
    color: options.color,
    emptyMessage: "No RepoVista findings found."
  });
}

function handleFindingsMenuKey(
  findings: StructuredFinding[],
  state: { cursor: number; detail: boolean; scroll: number },
  key: TuiKey,
  now: Date,
  rows: number,
  columns: number
): boolean {
  if ((key.ctrl && key.name === "c") || key.name === "q") {
    return false;
  }
  if (key.name && STATUS_KEYS[key.name]) {
    const finding = findings[state.cursor];
    const status = STATUS_KEYS[key.name];
    finding.status = status;
    finding.updatedAt = now.toISOString();
    finding.history = [
      ...(finding.history ?? []),
      {
        kind: "triage",
        status,
        note: "Updated from findings-ui.",
        commands: [],
        createdAt: now.toISOString()
      }
    ];
    return true;
  }
  if (state.detail) {
    const finding = findings[state.cursor];
    const lineCount = finding ? wrappedLineCount(findingDetailLines(finding), columns) : 0;
    const page = Math.max(4, rows - 8);
    const maxScroll = Math.max(0, lineCount - page);
    if (key.name === "escape" || key.name === "backspace" || key.name === "left" || key.name === "return" || key.name === "enter") {
      state.detail = false;
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
    return false;
  }
  if (key.name === "up") {
    state.cursor = wrapIndex(state.cursor - 1, findings.length);
  } else if (key.name === "down") {
    state.cursor = wrapIndex(state.cursor + 1, findings.length);
  } else if (key.name === "return" || key.name === "enter" || key.name === "right") {
    state.detail = true;
    state.scroll = 0;
  }
  return false;
}

function formatFindingItem(finding: StructuredFinding): string {
  return `${finding.severity.toUpperCase().padEnd(8)} ${(finding.status ?? "open").padEnd(14)} ${finding.id} ${finding.title}`;
}

function findingDetailLines(finding: StructuredFinding): string[] {
  return [
    finding.title,
    "",
    `Severity: ${finding.severity}`,
    `Status: ${finding.status ?? "open"}`,
    `Category: ${finding.category ?? "n/a"}`,
    `Paths: ${finding.paths.join(", ") || "n/a"}`,
    "",
    `Evidence: ${finding.evidence ?? "n/a"}`,
    "",
    `Recommendation: ${finding.recommendation ?? "n/a"}`,
    "",
    `Rationale: ${finding.problemRationale ?? "n/a"}`
  ];
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}
