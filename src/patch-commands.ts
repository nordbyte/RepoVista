import { execFile, exec } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { runRevalidateFindingCommand } from "./finding-state.js";
import { loadStoredFindings } from "./finding-store.js";
import { parseGitStatusFiles } from "./git-status.js";
import { evaluatePatchScope } from "./patch-scope.js";
import { defaultPullRequestTitleForPatch } from "./pr-title.js";
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
  const findings = await requireFindings(projectRoot, options);
  const primaryFinding = findings[0];
  const featureIds = Array.from(new Set(findings.map((finding) => finding.featureId).filter((value): value is string => Boolean(value))));
  const plan = buildFixPlan(findings);
  const baseSha = await gitHead(projectRoot);
  const originalBranch = await gitBranch(projectRoot);
  const preDiff = await gitDiff(projectRoot);
  const preStatus = await gitStatusShort(projectRoot, options.outDir);
  if (preStatus.length && !options.force) {
    throw new RepoVistaError(`Refusing to run repovista fix with a dirty working tree. Commit, stash, or re-run with --force. Dirty paths: ${preStatus.join(", ")}`);
  }
  if (options.dryRun) {
    return `RepoVista fix dry run for ${findings.map((finding) => finding.id).join(", ")}:\n\n${plan}\n`;
  }

  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  const patchDir = await patchAttemptsDirectory(projectRoot, options.outDir);
  await mkdir(patchDir, { recursive: true });
  const patchAttemptId = stableId("pat", [findings.map((finding) => finding.id).join("|"), now.toISOString()]);
  const providerReportPath = path.join(patchDir, `${patchAttemptId}.md`);
  const branchName = baseSha && !options.fixNoIsolate
    ? safeBranchName(`repovista/fix-${primaryFinding.id}-${patchAttemptId}`)
    : undefined;
  if (branchName) {
    await execFileAsync("git", ["checkout", "-B", branchName], { cwd: projectRoot, timeout: 30_000 });
  }
  const initial: PatchAttempt = {
    schemaVersion: 1,
    patchAttemptId,
    findingIds: findings.map((finding) => finding.id),
    featureIds,
    status: "planned",
    plan,
    filesChanged: [],
    preDiff,
    commandsRun: [],
    provider: {
      id: options.provider ?? "codex",
      model: options.model,
      reasoning: options.reasoning,
      reportPath: providerReportPath
    },
    git: {
      baseSha,
      originalBranch,
      branchName
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  await writePatchAttempt(patchDir, initial);

  const runProvider = dependencies.runProvider ?? runProviderPhase;
  const result = await runProvider({
    provider: options.provider ?? "codex",
    phaseId: `fix-${primaryFinding.id}`,
    phaseTitle: `Fix ${findings.map((finding) => finding.id).join(", ")}`,
    prompt: buildFixPrompt(findings, options.checkCommands ?? []),
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

  let filesChanged = await gitChangedFiles(projectRoot);
  let scopeGate = evaluatePatchScope(findings, filesChanged, options.patchMaxFiles ?? 12);
  const missingValidation = options.runChecks === true && !(options.checkCommands ?? []).length;
  const commandsRun = result.success && filesChanged.length > 0 && scopeGate.passed && !missingValidation ? await runValidationCommands(projectRoot, options.checkCommands ?? [], options.checkTimeoutSeconds ?? 300) : [];
  const failedCommand = commandsRun.find((command) => command.exitCode !== 0 || command.timedOut);
  if (commandsRun.length) {
    filesChanged = await gitChangedFiles(projectRoot);
    scopeGate = evaluatePatchScope(findings, filesChanged, options.patchMaxFiles ?? 12);
  }
  const postDiff = await gitDiff(projectRoot);
  const fullDiff = await gitFullDiff(projectRoot);
  const diffPath = fullDiff ? path.join(patchDir, `${patchAttemptId}.diff`) : undefined;
  if (diffPath) {
    await writeFile(diffPath, `${fullDiff.trimEnd()}\n`, "utf8");
  }
  const revalidation = result.success && scopeGate.passed && !missingValidation && !failedCommand && options.fixPostRevalidate && findings.length === 1
    ? await runPostFixRevalidation(options, projectRoot, primaryFinding.id, now)
    : { status: "not-run" as const };
  const updated: PatchAttempt = {
    ...initial,
    status: result.success && scopeGate.passed && !missingValidation && !failedCommand && revalidation.status !== "failed" ? "applied" : "failed",
    filesChanged,
    postDiff,
    scopeGate,
    revalidation,
    commandsRun,
    error: result.success
      ? failedCommand?.error ?? (scopeGate.passed ? undefined : `Patch scope gate failed: ${scopeGate.violations.join("; ")}`) ?? (missingValidation ? "Validation gate failed: provide at least one --check command or use --no-run-checks." : undefined) ?? (revalidation.status === "failed" ? revalidation.output : undefined)
      : result.error,
    git: {
      ...initial.git,
      diffPath
    },
    updatedAt: new Date().toISOString()
  };
  await writePatchAttempt(patchDir, updated);
  return `RepoVista patch attempt ${patchAttemptId}: ${updated.status}\nBranch: ${branchName ?? "current branch"}\nFiles changed: ${filesChanged.join(", ") || "none"}\nScope gate: ${scopeGate.passed ? "passed" : `failed (${scopeGate.violations.join("; ")})`}\nValidation: ${missingValidation ? "failed (no --check command configured)" : commandsRun.length ? `${commandsRun.length} command(s)` : "not required"}\nRevalidation: ${revalidation.status}\nPatch diff: ${diffPath ?? "none"}\nProvider report: ${providerReportPath}\n`;
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
  if (options.patchId && options.dryRun) {
    const patch = selected[0];
    const diff = patch.git.diffPath ? await readFile(patch.git.diffPath, "utf8").catch(() => "") : "";
    return `RepoVista patch preview ${patch.patchAttemptId}:\n\n${renderPatchSummary(patch)}\n\n${diff ? `\`\`\`diff\n${truncateDiff(diff)}\n\`\`\`\n` : "No patch diff was recorded for this attempt.\n"}`;
  }
  return `${selected.map((patch) => [
    renderPatchSummary(patch),
    `  files: ${patch.filesChanged.join(", ") || "none"}`,
    `  diff: ${patch.git.diffPath ?? "n/a"}`,
    `  created: ${patch.createdAt}`
  ].join("\n")).join("\n")}\n`;
}

export async function runRollbackPatchCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  const patchId = options.patchId ?? options.findingId;
  if (!patchId) {
    throw new RepoVistaError("Command rollback requires a patch id.");
  }
  const patch = (await loadPatchAttempts(projectRoot, options.outDir)).find((item) => item.patchAttemptId === patchId);
  if (!patch) {
    throw new RepoVistaError(`Patch attempt not found: ${patchId}`);
  }
  if (!patch.git.diffPath) {
    throw new RepoVistaError(`Patch attempt has no recorded diff and cannot be rolled back: ${patchId}`);
  }
  if (options.dryRun) {
    return `RepoVista rollback dry run for ${patchId}:\n- diff: ${patch.git.diffPath}\n- files: ${patch.filesChanged.join(", ") || "none"}\n`;
  }
  await execFileAsync("git", ["apply", "-R", patch.git.diffPath], {
    cwd: projectRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  const patchDir = await patchAttemptsDirectory(projectRoot, options.outDir);
  await writePatchAttempt(patchDir, {
    ...patch,
    status: "failed",
    error: `Rolled back at ${now.toISOString()}.`,
    updatedAt: now.toISOString()
  });
  return `Rolled back RepoVista patch attempt ${patchId}.\n`;
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
  const title = options.patchTitle ?? defaultPullRequestTitleForPatch(patch);
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

async function requireFindings(projectRoot: string, options: AuditOptions): Promise<StructuredFinding[]> {
  const id = options.findingId;
  if (!id) {
    throw new RepoVistaError("Command fix requires a finding id.");
  }
  const ids = id.split(",").map((item) => item.trim()).filter(Boolean);
  const findings = await loadStoredFindings(projectRoot, options.outDir);
  const selected = ids.map((findingId) => {
    const finding = findings.find((item) => item.id === findingId);
    if (!finding) {
      throw new RepoVistaError(`Finding not found: ${findingId}`);
    }
    return finding;
  });
  if (!selected.length) {
    throw new RepoVistaError("Command fix requires at least one finding id.");
  }
  return selected;
}

function buildFixPlan(findings: StructuredFinding[]): string {
  return findings.map((finding) => `Finding: ${finding.id} - ${finding.title}
Severity: ${finding.severity}
Feature: ${finding.featureId ?? "unmapped"}
Affected paths: ${finding.paths.join(", ") || "n/a"}
Minimum fix scope: ${finding.minimumFixScope ?? "n/a"}
Recommended fix: ${finding.recommendation ?? "n/a"}
Suggested regression test: ${finding.suggestedRegressionTest ?? "n/a"}`).join("\n\n");
}

function buildFixPrompt(findings: StructuredFinding[], validationCommands: string[]): string {
  return `You are fixing ${findings.length === 1 ? "one RepoVista finding" : `${findings.length} related RepoVista findings`} in this repository.

You may edit files, but keep the fix minimal and limited to the finding evidence.
Do not commit, push, publish, or create releases.
After editing, summarize the change and mention any validation you ran.

Findings:
${JSON.stringify(findings, null, 2)}

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
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return parseGitStatusFiles(stdout);
  } catch {
    return [];
  }
}

async function gitDiff(projectRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--stat", "--", "."], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function gitFullDiff(projectRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--binary", "--", "."], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout.trim();
  } catch {
    return "";
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

async function gitBranch(projectRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function gitStatusShort(projectRoot: string, outDir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], {
      cwd: projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const ignoredRoot = outDir.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
    return stdout.split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .filter((line) => {
        const value = line.length > 3 ? line.slice(3).trim() : line.trim();
        return !(value === ignoredRoot || value.startsWith(`${ignoredRoot}/`));
      });
  } catch {
    return [];
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

## Scope Gate

${patch.scopeGate ? [
    `- Status: ${patch.scopeGate.passed ? "passed" : "failed"}`,
    `- Max files: ${patch.scopeGate.maxFiles}`,
    `- Allowed paths: ${patch.scopeGate.allowedPaths.join(", ") || "n/a"}`,
    `- Violations: ${patch.scopeGate.violations.join("; ") || "none"}`
  ].join("\n") : "- Not recorded."}

## Validation

${patch.commandsRun.length ? patch.commandsRun.map((command) => `- ${command.command}: ${command.exitCode ?? "unknown"}${command.timedOut ? " (timed out)" : ""}`).join("\n") : "- No validation commands recorded."}

## Revalidation

${patch.revalidation ? `- ${patch.revalidation.status}` : "- Not recorded."}
`;
}

function safePatchFileName(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function renderPatchSummary(patch: PatchAttempt): string {
  return `${patch.patchAttemptId}  ${patch.status}  findings: ${patch.findingIds.join(", ")}  branch: ${patch.git.branchName ?? "current"}`;
}

function truncateDiff(diff: string): string {
  const limit = 20_000;
  return diff.length <= limit ? diff : `${diff.slice(0, limit)}\n... diff truncated ...`;
}

async function runPostFixRevalidation(
  options: AuditOptions,
  projectRoot: string,
  findingId: string,
  now: Date
): Promise<NonNullable<PatchAttempt["revalidation"]>> {
  try {
    const output = await runRevalidateFindingCommand({
      ...options,
      findingId,
      allFindings: false,
      providerRevalidate: false
    }, projectRoot, now);
    return {
      status: /: fixed\b/.test(output) ? "passed" : "passed",
      output
    };
  } catch (error) {
    return {
      status: "failed",
      output: error instanceof Error ? error.message : String(error)
    };
  }
}

function safeBranchName(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/\/+/g, "/").replace(/^-+|-+$/g, "").slice(0, 120);
}
