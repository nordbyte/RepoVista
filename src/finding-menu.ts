import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { RepoVistaError } from "./errors.js";
import { loadStoredFindings, rewriteFindingStateAtomic } from "./finding-store.js";
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
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new RepoVistaError("The findings-ui command requires an interactive terminal.", "FINDINGS_UI_NOT_INTERACTIVE");
  }
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  if (!findings.length) {
    return "No RepoVista findings found.\n";
  }

  let cursor = 0;
  let detail = false;
  let dirty = false;
  let done = false;
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write("\x1b[?25l");

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h");
    };
    const finish = async () => {
      cleanup();
      if (dirty) {
        await rewriteFindingStateAtomic(projectRoot, options.outDir, findings);
      }
      resolve(dirty ? "\nSaved RepoVista finding state.\n" : "\nFinding state unchanged.\n");
    };
    const onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
      void (async () => {
        if (key.ctrl && key.name === "c") {
          done = true;
        } else if (key.name === "up") {
          cursor = (cursor - 1 + findings.length) % findings.length;
        } else if (key.name === "down") {
          cursor = (cursor + 1) % findings.length;
        } else if (key.name === "return" || key.name === "enter") {
          detail = !detail;
        } else if (key.name === "q" || key.name === "escape") {
          done = true;
        } else if (key.name && STATUS_KEYS[key.name]) {
          const finding = findings[cursor];
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
          dirty = true;
        }
        render();
        if (done) {
          await finish();
        }
      })().catch((error) => {
        cleanup();
        reject(error);
      });
    };
    const render = () => renderFindingMenu(findings, cursor, detail, output);
    render();
    input.on("keypress", onKeypress);
  });
}

function renderFindingMenu(findings: StructuredFinding[], cursor: number, detail: boolean, output: WriteStream): void {
  output.write("\x1b[2J\x1b[H");
  output.write("RepoVista Findings\n\n");
  output.write("Up/Down move, Enter toggles detail, o/f/p/w/u sets status, q exits.\n\n");
  findings.forEach((finding, index) => {
    const marker = index === cursor ? ">" : " ";
    output.write(`${marker} ${finding.severity.toUpperCase().padEnd(8)} ${(finding.status ?? "open").padEnd(14)} ${finding.id} ${finding.title}\n`);
  });
  if (detail) {
    const finding = findings[cursor];
    output.write(`\n${finding.title}\n`);
    output.write(`Paths: ${finding.paths.join(", ") || "n/a"}\n`);
    output.write(`Evidence: ${finding.evidence ?? "n/a"}\n`);
    output.write(`Recommendation: ${finding.recommendation ?? "n/a"}\n`);
  }
}
