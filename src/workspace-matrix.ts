import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAudit, type AuditDependencies, type AuditResult } from "./audit.js";
import { PreflightError } from "./errors.js";
import { createRunId } from "./run-id.js";
import { validateReportRoot } from "./reports.js";
import { detectWorkspaces } from "./workspaces.js";
import type { AuditOptions, WorkspaceInfo } from "./types.js";

export interface WorkspaceMatrixResult {
  runId: string;
  runDir: string;
  workspaceCount: number;
  exitCode: number;
  results: WorkspaceMatrixEntry[];
}

export interface WorkspaceMatrixEntry {
  workspace: WorkspaceInfo;
  reportDir?: string;
  runId?: string;
  exitCode: number;
  findingCount?: number;
  error?: string;
}

export async function runWorkspaceMatrix(options: AuditOptions, dependencies: AuditDependencies = {}): Promise<WorkspaceMatrixResult> {
  const projectRoot = dependencies.cwd ?? process.cwd();
  const now = dependencies.now ?? new Date();
  const detected = await detectWorkspaces(projectRoot);
  const workspaces = selectedMatrixWorkspaces(detected.workspaces, options);
  if (!workspaces.length) {
    throw new PreflightError("Workspace matrix requested, but RepoVista did not detect any matching workspaces.");
  }

  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  const runId = `workspace-matrix-${createRunId(now)}`;
  const runDir = path.join(outRoot, runId);
  await mkdir(runDir, { recursive: true });

  const results: WorkspaceMatrixEntry[] = [];
  for (const workspace of workspaces) {
    try {
      const result = await runAudit({
        ...options,
        workspace: workspace.path,
        workspaceMatrix: false,
        allWorkspaces: false,
        progress: false,
        json: options.json,
        ci: options.ci
      }, dependencies);
      results.push(matrixEntry(workspace, result));
    } catch (error) {
      results.push({
        workspace,
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const exitCode = results.some((entry) => entry.exitCode === 2)
    ? 2
    : results.some((entry) => entry.exitCode !== 0)
      ? 1
      : 0;
  const aggregate: WorkspaceMatrixResult = {
    runId,
    runDir,
    workspaceCount: workspaces.length,
    exitCode,
    results
  };
  await writeFile(path.join(runDir, "workspace-matrix.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "index.md"), renderWorkspaceMatrixMarkdown(aggregate), "utf8");
  return aggregate;
}

function selectedMatrixWorkspaces(workspaces: WorkspaceInfo[], options: AuditOptions): WorkspaceInfo[] {
  if (!options.workspace) {
    return workspaces;
  }
  const selector = normalize(options.workspace);
  return workspaces.filter((workspace) => normalize(workspace.path) === selector || normalize(workspace.name) === selector);
}

function matrixEntry(workspace: WorkspaceInfo, result: AuditResult): WorkspaceMatrixEntry {
  return {
    workspace,
    reportDir: result.paths.runDir,
    runId: result.paths.runId,
    exitCode: result.exitCode,
    findingCount: result.meta.findings.length
  };
}

function renderWorkspaceMatrixMarkdown(result: WorkspaceMatrixResult): string {
  return `# RepoVista Workspace Matrix

- Matrix run: ${result.runId}
- Workspaces: ${result.workspaceCount}
- Exit code: ${result.exitCode}

| Workspace | Path | Exit | Findings | Report |
|---|---|---:|---:|---|
${result.results.map((entry) => `| ${escapeCell(entry.workspace.name)} | \`${escapeCell(entry.workspace.path)}\` | ${entry.exitCode} | ${entry.findingCount ?? "n/a"} | ${entry.reportDir ? `\`${escapeCell(entry.reportDir)}\`` : escapeCell(entry.error ?? "failed")} |`).join("\n")}
`;
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
