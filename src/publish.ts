import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { evidenceReferencesForFinding } from "./evidence-validation.js";
import { loadStoredFindings, rewriteFindingStateAtomic } from "./finding-store.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import { validateReportRoot } from "./reports.js";
import { stableId } from "./stable-id.js";
import type {
  AuditMeta,
  AuditOptions,
  EvidenceCommandResult,
  FindingPullRequestLink,
  PatchAttempt,
  PublishTarget,
  StructuredFinding
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface PublishDependencies {
  now?: Date;
  execFile?: (command: string, args: string[], options: ExecFileOptions) => Promise<ExecFileResult>;
  runProvider?: typeof runProviderPhase;
  spawnAdapter?: SpawnAdapter;
}

export interface ExecFileOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
}

export interface ExecFileResult {
  stdout: string;
  stderr?: string;
}

interface PublishRunContext {
  outRoot: string;
  runDir: string;
  meta: AuditMeta;
  findings: StructuredFinding[];
}

interface GithubPublishTarget {
  repository: string;
  owner: string;
  repo: string;
  url: string;
  commit: string;
  defaultBranch?: string;
}

export async function runPublishCommand(
  options: AuditOptions,
  projectRoot = process.cwd(),
  dependencies: PublishDependencies = {}
): Promise<string> {
  const target = requirePublishTarget(options.publishTarget);
  const context = await loadPublishRunContext(projectRoot, options);
  const github = requireGithubSource(context.meta);
  const selected = selectFindings(context.findings, options);
  if (!selected.length) {
    throw new RepoVistaError("No RepoVista findings selected for publishing.");
  }

  return target === "issue"
    ? publishIssues({ projectRoot, context, github, findings: selected, options, dependencies })
    : publishPullRequest({ projectRoot, context, github, findings: selected, options, dependencies });
}

async function publishIssues(input: {
  projectRoot: string;
  context: PublishRunContext;
  github: GithubPublishTarget;
  findings: StructuredFinding[];
  options: AuditOptions;
  dependencies: PublishDependencies;
}): Promise<string> {
  const now = input.dependencies.now ?? new Date();
  const exec = input.dependencies.execFile ?? defaultExecFile;
  if (input.options.dryRun) {
    return `RepoVista publish dry run: ${input.findings.length} GitHub issue(s) for ${input.github.repository}\n\n${input.findings.map((finding) => renderIssuePreview(finding, input.github, input.context.meta, input.options)).join("\n\n---\n\n")}\n`;
  }

  const rows: string[] = [];
  const updates = new Map<string, StructuredFinding>();
  for (const finding of input.findings) {
    const body = renderIssueBody(finding, input.github, input.context.meta);
    const existing = await findExistingIssue(exec, input.context.meta.projectRoot, input.github.repository, finding.id);
    if (existing && !input.options.issueUpdateExisting && !input.options.issueSync) {
      const linked = issueLinkedFinding(finding, existing, existing.state ?? "unknown", input.options, now, "Existing GitHub issue detected.");
      updates.set(finding.id, linked);
      rows.push(`- ${finding.id}: existing ${existing.url ?? ""}`.trimEnd());
      continue;
    }

    if (existing) {
      await exec("gh", ["issue", "comment", String(existing.number), "-R", input.github.repository, "--body", `${body}\n\n_RepoVista synced this issue from finding ${finding.id}._`], {
        cwd: input.context.meta.projectRoot,
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      });
      if (input.options.issueReopen && (finding.status ?? "open") === "open") {
        await exec("gh", ["issue", "reopen", String(existing.number), "-R", input.github.repository], {
          cwd: input.context.meta.projectRoot,
          timeout: 30_000,
          maxBuffer: 1024 * 1024
        }).catch(() => ({ stdout: "" }));
      }
      await applyIssueMetadata(exec, input.context.meta.projectRoot, input.github.repository, existing.number, combinedIssueLabels(finding, input.options), input.options.issueAssignees ?? []);
      const linked = issueLinkedFinding(finding, existing, "open", input.options, now, "Synced existing GitHub issue.");
      updates.set(finding.id, linked);
      rows.push(`- ${finding.id}: updated ${existing.url ?? ""}`.trimEnd());
      continue;
    }

    const args = ["issue", "create", "-R", input.github.repository, "--title", issueTitle(finding), "--body", body];
    for (const label of combinedIssueLabels(finding, input.options)) {
      args.push("--label", label);
    }
    for (const assignee of input.options.issueAssignees ?? []) {
      args.push("--assignee", assignee);
    }
    const created = await exec("gh", args, {
      cwd: input.context.meta.projectRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const url = firstUrl(created.stdout);
    const linked = issueLinkedFinding(finding, { number: issueNumberFromUrl(url), title: issueTitle(finding), url }, "open", input.options, now, "Created GitHub issue.");
    updates.set(finding.id, linked);
    rows.push(`- ${finding.id}: created ${url ?? ""}`.trimEnd());
  }

  await persistFindingUpdates(input.projectRoot, input.options.outDir, input.context, updates);
  return `RepoVista published GitHub issue(s) to ${input.github.repository}:\n${rows.join("\n")}\n`;
}

async function publishPullRequest(input: {
  projectRoot: string;
  context: PublishRunContext;
  github: GithubPublishTarget;
  findings: StructuredFinding[];
  options: AuditOptions;
  dependencies: PublishDependencies;
}): Promise<string> {
  const now = input.dependencies.now ?? new Date();
  const exec = input.dependencies.execFile ?? defaultExecFile;
  const runProvider = input.dependencies.runProvider ?? runProviderPhase;
  const primary = input.findings[0];
  const patchAttemptId = stableId("pat", [input.context.meta.runId, input.findings.map((finding) => finding.id).join(","), now.toISOString()]);
  const branch = input.options.patchBranch ?? safeBranchName(`repovista/fix-${primary.id}-${patchAttemptId}`);
  const title = input.options.patchTitle ?? `RepoVista: fix ${input.findings.map((finding) => finding.id).join(", ")}`;
  const patchDir = path.join(input.context.outRoot, "patches");
  const publishRoot = path.join(input.context.outRoot, "publish", input.context.meta.runId, patchAttemptId);
  const worktree = path.join(publishRoot, "worktree");
  const providerReportPath = path.join(patchDir, `${patchAttemptId}.md`);

  if (input.options.dryRun) {
    return `RepoVista publish dry run: pull request for ${input.github.repository}
- Run: ${input.context.meta.runId}
- Branch: ${branch}
- Base: ${input.options.baseRef ?? input.github.defaultBranch ?? "main"}
- Findings: ${input.findings.map((finding) => finding.id).join(", ")}
- Worktree: ${worktree}

${buildFixPlan(input.findings)}
`;
  }

  await rm(publishRoot, { recursive: true, force: true });
  await mkdir(patchDir, { recursive: true });
  await mkdir(path.dirname(worktree), { recursive: true });
  await exec("git", ["clone", input.github.url, worktree], { cwd: input.projectRoot, timeout: 120_000, maxBuffer: 1024 * 1024 });
  await exec("git", ["checkout", "-B", branch, input.github.commit], { cwd: worktree, timeout: 30_000, maxBuffer: 1024 * 1024 });

  const baseSha = await gitHead(exec, worktree);
  const originalBranch = await gitBranch(exec, worktree);
  const preDiff = await gitDiff(exec, worktree, "stat");
  const preStatus = await gitStatusShort(exec, worktree);
  if (preStatus.length && !input.options.force) {
    throw new RepoVistaError(`Refusing to publish PR with a dirty generated worktree. Dirty paths: ${preStatus.join(", ")}`);
  }

  const initial: PatchAttempt = {
    schemaVersion: 1,
    patchAttemptId,
    findingIds: input.findings.map((finding) => finding.id),
    featureIds: Array.from(new Set(input.findings.map((finding) => finding.featureId).filter((value): value is string => Boolean(value)))),
    status: "planned",
    plan: buildFixPlan(input.findings),
    filesChanged: [],
    preDiff,
    commandsRun: [],
    provider: {
      id: input.options.provider ?? "codex",
      model: input.options.model,
      reasoning: input.options.reasoning,
      reportPath: providerReportPath
    },
    git: {
      baseSha,
      originalBranch,
      branchName: branch
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  await writePatchAttempt(patchDir, initial);

  const providerResult = await runProvider({
    provider: input.options.provider ?? "codex",
    phaseId: `publish-pr-${patchAttemptId}`,
    phaseTitle: `Publish PR for ${input.findings.map((finding) => finding.id).join(", ")}`,
    prompt: buildFixPrompt(input.findings, input.options.checkCommands ?? [], input.github, input.context.meta),
    projectRoot: worktree,
    reportPath: providerReportPath,
    model: input.options.model,
    profile: input.options.profile,
    reasoning: input.options.reasoning,
    fastMode: input.options.fastMode,
    sandbox: "workspace-write",
    jsonEvents: input.options.json,
    keepLogs: input.options.keepLogs,
    timeoutSeconds: input.options.phaseTimeoutSeconds ?? 1800
  }, input.dependencies.spawnAdapter);

  const filesChanged = await gitChangedFiles(exec, worktree);
  const postDiff = await gitDiff(exec, worktree, "stat");
  const fullDiff = await gitDiff(exec, worktree, "binary");
  const diffPath = fullDiff ? path.join(patchDir, `${patchAttemptId}.diff`) : undefined;
  if (diffPath) {
    await writeFile(diffPath, `${fullDiff.trimEnd()}\n`, "utf8");
  }
  const scopeGate = evaluatePatchScope(input.findings, filesChanged, input.options.patchMaxFiles ?? 12);
  const missingValidation = input.options.runChecks === true && !(input.options.checkCommands ?? []).length;
  const commandsRun = providerResult.success && scopeGate.passed && !missingValidation
    ? await runValidationCommands(exec, worktree, input.options.checkCommands ?? [], input.options.checkTimeoutSeconds ?? 300)
    : [];
  const failedCommand = commandsRun.find((command) => command.exitCode !== 0 || command.timedOut);
  let updated: PatchAttempt = {
    ...initial,
    status: providerResult.success && filesChanged.length > 0 && scopeGate.passed && !missingValidation && !failedCommand ? "applied" : "failed",
    filesChanged,
    postDiff,
    scopeGate,
    commandsRun,
    error: providerResult.success
      ? (!filesChanged.length ? "Provider did not change any files." : undefined) ??
        (scopeGate.passed ? undefined : `Patch scope gate failed: ${scopeGate.violations.join("; ")}`) ??
        (missingValidation ? "Validation gate failed: provide at least one --check command or use --no-run-checks." : undefined) ??
        failedCommand?.error
      : providerResult.error,
    git: {
      ...initial.git,
      diffPath
    },
    updatedAt: new Date().toISOString()
  };
  await writePatchAttempt(patchDir, updated);
  if (!filesChanged.length) {
    throw new RepoVistaError(updated.error ?? `Patch attempt ${patchAttemptId} did not change any files.`);
  }
  if (updated.status !== "applied" && !input.options.force) {
    throw new RepoVistaError(updated.error ?? `Patch attempt ${patchAttemptId} did not pass publication gates.`);
  }

  await exec("git", ["add", ...filesChanged], { cwd: worktree, timeout: 30_000, maxBuffer: 1024 * 1024 });
  await exec("git", ["commit", "-m", title], { cwd: worktree, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const commitSha = await gitHead(exec, worktree);
  const push = await pushBranch(exec, worktree, input.github.repository, branch, Boolean(input.options.publishFork));
  const body = renderPatchPrBody(updated, input.github, input.context.meta);
  const pr = await exec("gh", ["pr", "create", "-R", input.github.repository, "--base", input.options.baseRef ?? input.github.defaultBranch ?? "main", "--head", push.head, "--title", title, "--body", body], {
    cwd: worktree,
    timeout: 120_000,
    maxBuffer: 1024 * 1024
  });
  const prUrl = firstUrl(pr.stdout);
  updated = {
    ...updated,
    status: "pr-opened",
    git: {
      ...updated.git,
      branchName: branch,
      commitSha,
      prUrl
    },
    updatedAt: new Date().toISOString()
  };
  await writePatchAttempt(patchDir, updated);

  const pullRequest = pullRequestLinkedFinding(prUrl, title, branch, patchAttemptId, now);
  const updates = new Map(input.findings.map((finding) => [finding.id, {
    ...finding,
    pullRequest,
    updatedAt: now.toISOString(),
    history: appendHistory(finding.history, {
      kind: "pr-opened",
      status: finding.status ?? "open",
      note: `Opened GitHub pull request${prUrl ? `: ${prUrl}` : "."}`,
      commands: ["gh pr create"],
      createdAt: now.toISOString()
    })
  } satisfies StructuredFinding]));
  await persistFindingUpdates(input.projectRoot, input.options.outDir, input.context, updates);
  return `RepoVista published pull request for ${input.github.repository}:\n${prUrl ?? "PR URL not returned by gh"}\nPatch attempt: ${patchAttemptId}\nBranch: ${push.remote}/${branch}\n`;
}

async function loadPublishRunContext(projectRoot: string, options: AuditOptions): Promise<PublishRunContext> {
  if (!options.findingRunId) {
    throw new RepoVistaError("Command publish requires --run <run-id|dir>.");
  }
  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  const runDir = resolveRunDirectory(projectRoot, outRoot, options.findingRunId);
  const [meta, findings] = await Promise.all([
    readJson<AuditMeta>(path.join(runDir, "meta.json")),
    readJson<StructuredFinding[]>(path.join(runDir, "findings.json"))
  ]);
  if (!Array.isArray(findings)) {
    throw new RepoVistaError(`Could not read findings.json for run ${options.findingRunId}.`);
  }
  return { outRoot, runDir, meta, findings };
}

function resolveRunDirectory(projectRoot: string, outRoot: string, value: string): string {
  const candidate = value.includes("/") || value.startsWith(".")
    ? path.resolve(projectRoot, value)
    : path.join(outRoot, value);
  const relative = path.relative(outRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RepoVistaError(`Run directory must be inside ${outRoot}: ${value}`);
  }
  return candidate;
}

async function readJson<T>(filePath: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoVistaError(`Could not read ${filePath}: ${message}`);
  }
}

function requirePublishTarget(value: PublishTarget | undefined): PublishTarget {
  if (!value) {
    throw new RepoVistaError("Command publish requires --as issue or --as pr.");
  }
  return value;
}

function requireGithubSource(meta: AuditMeta): GithubPublishTarget {
  if (meta.source?.type !== "github") {
    throw new RepoVistaError("Command publish requires a report generated with --github-repo.");
  }
  return {
    repository: meta.source.repository,
    owner: meta.source.owner,
    repo: meta.source.repo,
    url: meta.source.url,
    commit: meta.source.commit,
    defaultBranch: meta.source.defaultBranch
  };
}

function selectFindings(findings: StructuredFinding[], options: AuditOptions): StructuredFinding[] {
  const status = options.findingStatus;
  if (options.allFindings) {
    return findings.filter((finding) => !status || (finding.status ?? "open") === status);
  }
  if (!options.findingId) {
    throw new RepoVistaError("Command publish requires a finding id or --all.");
  }
  const ids = options.findingId.split(",").map((item) => item.trim()).filter(Boolean);
  return ids.map((id) => {
    const finding = findings.find((item) => item.id === id);
    if (!finding) {
      throw new RepoVistaError(`Finding not found in selected run: ${id}`);
    }
    return finding;
  });
}

function renderIssuePreview(finding: StructuredFinding, github: GithubPublishTarget, meta: AuditMeta, options: AuditOptions): string {
  return `Title: ${issueTitle(finding)}
Repository: ${github.repository}
Labels: ${combinedIssueLabels(finding, options).join(", ") || "n/a"}
Assignees: ${(options.issueAssignees ?? []).join(", ") || "n/a"}
Update existing: ${options.issueUpdateExisting || options.issueSync ? "yes" : "no"}
Reopen linked: ${options.issueReopen ? "yes" : "no"}

${renderIssueBody(finding, github, meta)}`;
}

function issueTitle(finding: StructuredFinding): string {
  return `[RepoVista] ${finding.severity.toUpperCase()}: ${finding.title}`;
}

function renderIssueBody(finding: StructuredFinding, github: GithubPublishTarget, meta: AuditMeta): string {
  return `## RepoVista Finding

<!-- repovista:finding:${finding.id} -->

- ID: ${finding.id}
- Severity: ${finding.severity}
- Status: ${finding.status ?? "open"}
- Category: ${finding.category ?? "n/a"}
- Confidence: ${finding.confidence ?? "n/a"}
- Repository: ${github.repository}
- Analyzed commit: ${commitLink(github)}
- RepoVista run: ${meta.runId}

## Affected Paths

${renderList(finding.paths)}

## Evidence

${finding.evidence ?? "n/a"}

${renderEvidenceLinks(finding, github)}

## Problem Rationale

${finding.problemRationale ?? "n/a"}

## Recommended Fix

${finding.recommendation ?? "n/a"}

## Suggested Regression Test

${finding.suggestedRegressionTest ?? "n/a"}
`;
}

function renderEvidenceLinks(finding: StructuredFinding, github: GithubPublishTarget): string {
  const references = evidenceReferencesForFinding(finding);
  if (!references.length) {
    return "## Evidence Links\n\n- n/a";
  }
  return `## Evidence Links

${references.map((reference) => `- ${githubLineLink(github, reference.path, reference.startLine, reference.endLine)}`).join("\n")}`;
}

function githubLineLink(github: GithubPublishTarget, filePath: string, startLine?: number, endLine?: number): string {
  const cleanPath = filePath.replace(/^\/+/, "");
  const suffix = startLine
    ? endLine && endLine !== startLine
      ? `#L${startLine}-L${endLine}`
      : `#L${startLine}`
    : "";
  return `https://github.com/${github.repository}/blob/${github.commit}/${encodePath(cleanPath)}${suffix}`;
}

function encodePath(value: string): string {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function commitLink(github: GithubPublishTarget): string {
  return `[${github.commit.slice(0, 12)}](https://github.com/${github.repository}/commit/${github.commit})`;
}

async function findExistingIssue(
  exec: NonNullable<PublishDependencies["execFile"]>,
  cwd: string,
  repository: string,
  findingId: string
): Promise<{ number?: number; title?: string; url?: string; state?: "open" | "closed" | "unknown" } | undefined> {
  try {
    const { stdout } = await exec("gh", [
      "issue",
      "list",
      "-R",
      repository,
      "--search",
      `repovista:finding:${findingId} in:body`,
      "--state",
      "all",
      "--json",
      "number,title,url,state",
      "--limit",
      "10"
    ], {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(stdout) as Array<{ number?: number; title?: string; url?: string; state?: string }>;
    const match = parsed.find((issue) => typeof issue.number === "number" && issue.url);
    return match
      ? {
          number: match.number,
          title: match.title,
          url: match.url,
          state: match.state === "OPEN" || match.state === "open" ? "open" : match.state === "CLOSED" || match.state === "closed" ? "closed" : "unknown"
        }
      : undefined;
  } catch {
    return undefined;
  }
}

async function applyIssueMetadata(
  exec: NonNullable<PublishDependencies["execFile"]>,
  cwd: string,
  repository: string,
  issueNumber: number | undefined,
  labels: string[],
  assignees: string[]
): Promise<void> {
  if (!issueNumber || (!labels.length && !assignees.length)) {
    return;
  }
  const args = ["issue", "edit", String(issueNumber), "-R", repository];
  for (const label of labels) {
    args.push("--add-label", label);
  }
  for (const assignee of assignees) {
    args.push("--add-assignee", assignee);
  }
  await exec("gh", args, { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 });
}

function issueLinkedFinding(
  finding: StructuredFinding,
  issue: { number?: number; title?: string; url?: string },
  state: "open" | "closed" | "unknown",
  options: AuditOptions,
  now: Date,
  note: string
): StructuredFinding {
  const status = finding.status ?? "open";
  return {
    ...finding,
    issue: {
      provider: "github",
      number: issue.number,
      url: issue.url,
      title: issue.title,
      state,
      syncedAt: now.toISOString(),
      labels: combinedIssueLabels(finding, options),
      assignees: options.issueAssignees ?? []
    },
    updatedAt: now.toISOString(),
    history: appendHistory(finding.history, {
      kind: "issue-sync",
      status,
      note,
      commands: ["gh issue"],
      createdAt: now.toISOString()
    })
  };
}

function combinedIssueLabels(finding: StructuredFinding, options: AuditOptions): string[] {
  return Array.from(new Set([
    ...(finding.labels ?? []),
    ...(options.issueLabels ?? [])
  ])).sort();
}

async function persistFindingUpdates(
  projectRoot: string,
  outDir: string,
  context: PublishRunContext,
  updates: Map<string, StructuredFinding>
): Promise<void> {
  if (!updates.size) {
    return;
  }
  const runFindings = context.findings.map((finding) => updates.get(finding.id) ?? finding);
  await writeFile(path.join(context.runDir, "findings.json"), `${JSON.stringify(runFindings, null, 2)}\n`, "utf8");
  const stored = await loadStoredFindings(projectRoot, outDir);
  const storedById = new Map(stored.map((finding) => [finding.id, finding]));
  for (const [id, finding] of updates) {
    storedById.set(id, {
      ...storedById.get(id),
      ...finding
    });
  }
  await rewriteFindingStateAtomic(projectRoot, outDir, Array.from(storedById.values()));
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

function buildFixPrompt(findings: StructuredFinding[], validationCommands: string[], github: GithubPublishTarget, meta: AuditMeta): string {
  return `You are fixing ${findings.length === 1 ? "one RepoVista finding" : `${findings.length} related RepoVista findings`} for ${github.repository}.

The analyzed RepoVista run was ${meta.runId} at commit ${github.commit}.
You may edit files in this generated worktree only. Keep the fix minimal and limited to the finding evidence.
Do not push, publish, create issues, create pull requests, or create releases. RepoVista will handle GitHub publishing after your patch.
After editing, summarize the change and mention any validation you ran.

Findings:
${JSON.stringify(findings, null, 2)}

Expected validation commands:
${validationCommands.length ? validationCommands.map((command) => `- ${command}`).join("\n") : "- none provided by the user; do not invent destructive checks"}

Return a concise Markdown fix report.`;
}

async function pushBranch(
  exec: NonNullable<PublishDependencies["execFile"]>,
  cwd: string,
  repository: string,
  branch: string,
  forceFork: boolean
): Promise<{ remote: string; head: string }> {
  if (!forceFork) {
    try {
      await exec("git", ["push", "-u", "origin", branch], { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 });
      return { remote: "origin", head: branch };
    } catch {
      // Fall back to a fork for public repositories where the user has no direct push access.
    }
  }

  await exec("gh", ["repo", "fork", repository, "--remote", "--remote-name", "repovista-fork"], {
    cwd,
    timeout: 120_000,
    maxBuffer: 1024 * 1024
  }).catch(() => ({ stdout: "" }));
  const user = await exec("gh", ["api", "user", "--jq", ".login"], {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  const login = user.stdout.trim();
  if (!login) {
    throw new RepoVistaError("Could not resolve GitHub login for fork-based PR publishing.");
  }
  const repoName = repository.split("/")[1];
  if (repoName) {
    await exec("git", ["remote", "get-url", "repovista-fork"], {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    }).catch(() => exec("git", ["remote", "add", "repovista-fork", `https://github.com/${login}/${repoName}.git`], {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    }));
  }
  await exec("git", ["push", "-u", "repovista-fork", branch], { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 });
  return { remote: "repovista-fork", head: `${login}:${branch}` };
}

function renderPatchPrBody(patch: PatchAttempt, github: GithubPublishTarget, meta: AuditMeta): string {
  return `## RepoVista Patch Attempt

<!-- repovista:patch:${patch.patchAttemptId} -->

- Patch: ${patch.patchAttemptId}
- Status: ${patch.status}
- Repository: ${github.repository}
- Analyzed commit: ${commitLink(github)}
- RepoVista run: ${meta.runId}
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
`;
}

async function runValidationCommands(
  exec: NonNullable<PublishDependencies["execFile"]>,
  cwd: string,
  commands: string[],
  timeoutSeconds: number
): Promise<EvidenceCommandResult[]> {
  const results: EvidenceCommandResult[] = [];
  for (const command of commands) {
    const started = Date.now();
    try {
      const { stdout, stderr } = await exec("sh", ["-lc", command], {
        cwd,
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

function evaluatePatchScope(
  findings: StructuredFinding[],
  filesChanged: string[],
  maxFiles: number
): NonNullable<PatchAttempt["scopeGate"]> {
  const allowedPaths = Array.from(new Set(findings.flatMap((finding) => finding.paths ?? []))).filter(Boolean);
  const violations: string[] = [];
  if (filesChanged.length > maxFiles) {
    violations.push(`changed ${filesChanged.length} files, max is ${maxFiles}`);
  }
  if (allowedPaths.length) {
    const outside = filesChanged.filter((file) => !allowedPaths.some((allowed) => file === allowed || file.startsWith(`${allowed.replace(/\/+$/g, "")}/`) || sameTopLevel(file, allowed)));
    if (outside.length) {
      violations.push(`changed files outside finding scope: ${outside.join(", ")}`);
    }
  }
  return {
    passed: violations.length === 0,
    maxFiles,
    allowedPaths,
    violations
  };
}

function sameTopLevel(left: string, right: string): boolean {
  const [leftTop] = left.split("/");
  const [rightTop] = right.split("/");
  return Boolean(leftTop && rightTop && leftTop === rightTop && (leftTop === "test" || leftTop === "tests"));
}

async function gitChangedFiles(exec: NonNullable<PublishDependencies["execFile"]>, cwd: string): Promise<string[]> {
  const { stdout } = await exec("git", ["diff", "--name-only"], { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 });
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function gitStatusShort(exec: NonNullable<PublishDependencies["execFile"]>, cwd: string): Promise<string[]> {
  const { stdout } = await exec("git", ["status", "--short"], { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 });
  return stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

async function gitDiff(exec: NonNullable<PublishDependencies["execFile"]>, cwd: string, mode: "stat" | "binary"): Promise<string> {
  const args = mode === "stat" ? ["diff", "--stat", "--", "."] : ["diff", "--binary", "--", "."];
  const { stdout } = await exec("git", args, { cwd, timeout: 30_000, maxBuffer: mode === "binary" ? 10 * 1024 * 1024 : 1024 * 1024 });
  return stdout.trim();
}

async function gitHead(exec: NonNullable<PublishDependencies["execFile"]>, cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function gitBranch(exec: NonNullable<PublishDependencies["execFile"]>, cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", ["branch", "--show-current"], { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function pullRequestLinkedFinding(
  url: string | undefined,
  title: string,
  branch: string,
  patchAttemptId: string,
  now: Date
): FindingPullRequestLink {
  return {
    provider: "github",
    number: pullRequestNumberFromUrl(url),
    url,
    title,
    state: "open",
    syncedAt: now.toISOString(),
    branch,
    patchAttemptId
  };
}

async function writePatchAttempt(dir: string, patch: PatchAttempt): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${safePatchFileName(patch.patchAttemptId)}.json`), `${JSON.stringify(patch, null, 2)}\n`, "utf8");
}

function appendHistory<T extends { createdAt: string }>(
  history: StructuredFinding["history"],
  entry: NonNullable<StructuredFinding["history"]>[number] & T
): NonNullable<StructuredFinding["history"]> {
  return [...(history ?? []), entry];
}

function renderList(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- n/a";
}

function firstUrl(value: string | undefined): string | undefined {
  return value?.trim().split(/\r?\n/).find((line) => /^https?:\/\//.test(line.trim()))?.trim();
}

function issueNumberFromUrl(url: string | undefined): number | undefined {
  const match = url?.match(/\/issues\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : undefined;
}

function pullRequestNumberFromUrl(url: string | undefined): number | undefined {
  const match = url?.match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : undefined;
}

function safePatchFileName(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeBranchName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function defaultExecFile(command: string, args: string[], options: ExecFileOptions): Promise<ExecFileResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer
  });
  return { stdout, stderr };
}
