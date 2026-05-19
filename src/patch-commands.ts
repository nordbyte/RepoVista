import { execFile, exec } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { loadStoredFindings } from "./finding-store.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { validateReportRoot } from "./reports.js";
import { stableId } from "./stable-id.js";
import type { AuditOptions, EvidenceCommandResult, PatchAttempt, StructuredFinding } from "./types.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export async function runFixFindingCommand(
  options: AuditOptions,
  dependencies: {
    projectRoot?: string;
    now?: Date;
    runProvider?: typeof runProviderPhase;
    spawnAdapter?: SpawnAdapter;
  } = {}
): Promise<string> {
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const now = dependencies.now ?? new Date();
  const finding = await requireFinding(projectRoot, options);
  const featureIds = finding.featureId ? [finding.featureId] : [];
  const plan = buildFixPlan(finding);
  if (options.dryRun) {
    return `RepoVista fix dry run for ${finding.id}:\n\n${plan}\n`;
  }

  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  const patchDir = await patchAttemptsDirectory(projectRoot, options.outDir);
  await mkdir(patchDir, { recursive: true });
  const patchAttemptId = stableId("pat", [finding.id, now.toISOString()]);
  const providerReportPath = path.join(patchDir, `${patchAttemptId}.md`);
  const initial: PatchAttempt = {
    schemaVersion: 1,
    patchAttemptId,
    findingIds: [finding.id],
    featureIds,
    status: "planned",
    plan,
    filesChanged: [],
    commandsRun: [],
    provider: {
      id: options.provider ?? "codex",
      model: options.model,
      reasoning: options.reasoning,
      reportPath: providerReportPath
    },
    git: {
      baseSha: await gitHead(projectRoot)
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  await writePatchAttempt(patchDir, initial);

  const runProvider = dependencies.runProvider ?? runProviderPhase;
  const result = await runProvider({
    provider: options.provider ?? "codex",
    phaseId: `fix-${finding.id}`,
    phaseTitle: `Fix ${finding.id}`,
    prompt: buildFixPrompt(finding, options.checkCommands ?? []),
    projectRoot,
    reportPath: providerReportPath,
    logsDir: options.keepLogs ? path.join(outRoot, "logs") : undefined,
    model: options.model,
    profile: options.profile,
    reasoning: options.reasoning,
    fastMode: options.fastMode,
    sandbox: "workspace-write",
    jsonEvents: options.json,
    keepLogs: options.keepLogs,
    timeoutSeconds: options.phaseTimeoutSeconds ?? 1800
  }, dependencies.spawnAdapter);

  const filesChanged = await gitChangedFiles(projectRoot);
  const commandsRun = result.success ? await runValidationCommands(projectRoot, options.checkCommands ?? [], options.checkTimeoutSeconds ?? 300) : [];
  const failedCommand = commandsRun.find((command) => command.exitCode !== 0 || command.timedOut);
  const updated: PatchAttempt = {
    ...initial,
    status: result.success && !failedCommand ? "applied" : "failed",
    filesChanged,
    commandsRun,
    error: result.success ? failedCommand?.error : result.error,
    updatedAt: new Date().toISOString()
  };
  await writePatchAttempt(patchDir, updated);
  return `RepoVista patch attempt ${patchAttemptId}: ${updated.status}\nFiles changed: ${filesChanged.join(", ") || "none"}\nProvider report: ${providerReportPath}\n`;
}

export async function runPatchesCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const patches = await loadPatchAttempts(projectRoot, options.outDir);
  const selected = options.patchId
    ? patches.filter((patch) => patch.patchAttemptId === options.patchId)
    : patches;
  if (options.patchId && !selected.length) {
    throw new RepoVistaError(`Patch attempt not found: ${options.patchId}`);
  }
  if (options.json) {
    return `${JSON.stringify(options.patchId ? selected[0] : selected, null, 2)}\n`;
  }
  if (!selected.length) {
    return `No RepoVista patch attempts found in ${await patchAttemptsDirectory(projectRoot, options.outDir)}.\n`;
  }
  return `${selected.map((patch) => [
    `${patch.patchAttemptId}  ${patch.status}  findings: ${patch.findingIds.join(", ")}`,
    `  files: ${patch.filesChanged.join(", ") || "none"}`,
    `  created: ${patch.createdAt}`
  ].join("\n")).join("\n")}\n`;
}

export async function runOpenPrCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const patchId = options.patchId ?? options.findingId;
  if (!patchId) {
    throw new RepoVistaError("Command open-pr requires a patch id.");
  }
  const patch = (await loadPatchAttempts(projectRoot, options.outDir)).find((item) => item.patchAttemptId === patchId);
  if (!patch) {
    throw new RepoVistaError(`Patch attempt not found: ${patchId}`);
  }
  if (!patch.filesChanged.length && !options.force) {
    throw new RepoVistaError("Patch attempt has no changed files. Use --force only if this is intentional.");
  }
  const base = options.baseRef ?? "main";
  const branch = options.patchBranch ?? `repovista/${patch.patchAttemptId}`;
  const title = options.patchTitle ?? `RepoVista: fix ${patch.findingIds.join(", ")}`;
  const body = renderPatchPrBody(patch);
  if (options.dryRun) {
    return `RepoVista open-pr dry run:
- branch: ${branch}
- base: ${base}
- title: ${title}
- files: ${patch.filesChanged.join(", ") || "none"}

${body}
`;
  }

  await execFileAsync("git", ["checkout", "-B", branch], { cwd: projectRoot, timeout: 30_000 });
  if (patch.filesChanged.length) {
    await execFileAsync("git", ["add", ...patch.filesChanged], { cwd: projectRoot, timeout: 30_000 });
  }
  await execFileAsync("git", ["commit", "-m", title], { cwd: projectRoot, timeout: 30_000 });
  const commitSha = await gitHead(projectRoot);
  await execFileAsync("git", ["push", "-u", "origin", branch], { cwd: projectRoot, timeout: 120_000 });
  const { stdout } = await execFileAsync("gh", ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body], {
    cwd: projectRoot,
    timeout: 120_000,
    maxBuffer: 1024 * 1024
  });
  const prUrl = stdout.trim();
  const patchDir = await patchAttemptsDirectory(projectRoot, options.outDir);
  await writePatchAttempt(patchDir, {
    ...patch,
    status: "pr-opened",
    git: {
      ...patch.git,
      branchName: branch,
      commitSha,
      prUrl
    },
    updatedAt: now.toISOString()
  });
  return `${prUrl || `Opened pull request for ${patch.patchAttemptId}.`}\n`;
}

export async function patchAttemptsDirectory(projectRoot: string, outDir: string): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  return path.join(outRoot, "patches");
}

export async function loadPatchAttempts(projectRoot: string, outDir: string): Promise<PatchAttempt[]> {
  const dir = await patchAttemptsDirectory(projectRoot, outDir);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const patches: PatchAttempt[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const parsed = JSON.parse(await readFile(path.join(dir, entry.name), "utf8")) as PatchAttempt;
    if (parsed.schemaVersion === 1 && parsed.patchAttemptId) {
      patches.push(parsed);
    }
  }
  return patches.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function writePatchAttempt(dir: string, patch: PatchAttempt): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${safePatchFileName(patch.patchAttemptId)}.json`), `${JSON.stringify(patch, null, 2)}\n`, "utf8");
}

async function requireFinding(projectRoot: string, options: AuditOptions): Promise<StructuredFinding> {
  const id = options.findingId;
  if (!id) {
    throw new RepoVistaError("Command fix requires a finding id.");
  }
  const finding = (await loadStoredFindings(projectRoot, options.outDir)).find((item) => item.id === id);
  if (!finding) {
    throw new RepoVistaError(`Finding not found: ${id}`);
  }
  return finding;
}

function buildFixPlan(finding: StructuredFinding): string {
  return `Finding: ${finding.id} - ${finding.title}
Severity: ${finding.severity}
Feature: ${finding.featureId ?? "unmapped"}
Affected paths: ${finding.paths.join(", ") || "n/a"}
Minimum fix scope: ${finding.minimumFixScope ?? "n/a"}
Recommended fix: ${finding.recommendation ?? "n/a"}
Suggested regression test: ${finding.suggestedRegressionTest ?? "n/a"}`;
}

function buildFixPrompt(finding: StructuredFinding, validationCommands: string[]): string {
  return `You are fixing one RepoVista finding in this repository.

You may edit files, but keep the fix minimal and limited to the finding evidence.
Do not commit, push, publish, or create releases.
After editing, summarize the change and mention any validation you ran.

Finding:
${JSON.stringify(finding, null, 2)}

Expected validation commands:
${validationCommands.length ? validationCommands.map((command) => `- ${command}`).join("\n") : "- none provided by the user; do not invent destructive checks"}

Return a concise Markdown fix report.`;
}

async function runValidationCommands(projectRoot: string, commands: string[], timeoutSeconds: number): Promise<EvidenceCommandResult[]> {
  const results: EvidenceCommandResult[] = [];
  for (const command of commands) {
    const started = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: projectRoot,
        timeout: timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024
      });
      results.push({
        command,
        exitCode: 0,
        durationMs: Date.now() - started,
        timedOut: false,
        stdout,
        stderr
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
      results.push({
        command,
        exitCode: typeof err.code === "number" ? err.code : null,
        durationMs: Date.now() - started,
        timedOut: Boolean(err.killed),
        stdout: err.stdout,
        stderr: err.stderr,
        error: err.message
      });
    }
  }
  return results;
}

async function gitChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only"], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function gitHead(projectRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function renderPatchPrBody(patch: PatchAttempt): string {
  return `## RepoVista Patch Attempt

- Patch: ${patch.patchAttemptId}
- Status: ${patch.status}
- Findings: ${patch.findingIds.join(", ")}
- Features: ${patch.featureIds.join(", ") || "n/a"}

## Plan

${patch.plan}

## Files Changed

${patch.filesChanged.length ? patch.filesChanged.map((file) => `- ${file}`).join("\n") : "- n/a"}

## Validation

${patch.commandsRun.length ? patch.commandsRun.map((command) => `- ${command.command}: ${command.exitCode ?? "unknown"}${command.timedOut ? " (timed out)" : ""}`).join("\n") : "- No validation commands recorded."}
`;
}

function safePatchFileName(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
