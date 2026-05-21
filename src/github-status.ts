import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { loadStoredFindings, rewriteFindingStateAtomic } from "./finding-store.js";
import { validateReportRoot } from "./reports.js";
import { maskSensitiveText } from "./secrets.js";
import type { AuditMeta, AuditOptions, FindingIssueLink, FindingPullRequestLink, StructuredFinding } from "./types.js";

type ExecFileAsync = (
  command: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number }
) => Promise<{ stdout: string; stderr?: string }>;

export interface GithubStatusDependencies {
  execFile?: ExecFileAsync;
}

interface GithubStatusContext {
  findings: StructuredFinding[];
  source: string;
  repository?: string;
  outRoot: string;
  runDir?: string;
}

interface GithubStatusRow {
  findingId: string;
  changed: boolean;
  messages: string[];
}

const execFileAsync = promisify(execFile) as ExecFileAsync;
const GH_TIMEOUT_MS = 30_000;
const GH_MAX_BUFFER = 1024 * 1024;

export async function runGithubStatusCommand(
  options: AuditOptions,
  projectRoot = process.cwd(),
  now = new Date(),
  dependencies: GithubStatusDependencies = {}
): Promise<string> {
  const context = await loadGithubStatusContext(projectRoot, options);
  const selected = selectGithubStatusFindings(context.findings, options);
  if (!selected.length) {
    return `No RepoVista findings with linked GitHub issues or pull requests found in ${context.source}.\n`;
  }

  const exec = dependencies.execFile ?? execFileAsync;
  const updates = new Map<string, StructuredFinding>();
  const rows: GithubStatusRow[] = [];
  for (const finding of selected) {
    const synced = await syncGithubStatusForFinding({
      finding,
      repository: context.repository,
      cwd: projectRoot,
      now,
      exec
    });
    updates.set(finding.id, synced.finding);
    rows.push({
      findingId: finding.id,
      changed: synced.changed,
      messages: synced.messages
    });
  }

  await persistGithubStatusUpdates(projectRoot, options.outDir, context, updates);

  if (options.json) {
    return `${JSON.stringify({
      source: context.source,
      updated: rows.filter((row) => row.changed).length,
      rows,
      findings: context.findings.map((finding) => updates.get(finding.id) ?? finding)
    }, null, 2)}\n`;
  }

  return `GitHub status sync completed:\n${rows.map((row) => `- ${row.findingId}: ${row.messages.join("; ")}`).join("\n")}\n`;
}

async function loadGithubStatusContext(projectRoot: string, options: AuditOptions): Promise<GithubStatusContext> {
  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  if (!options.findingRunId) {
    const stateDir = path.join(outRoot, "findings");
    return {
      findings: await loadStoredFindings(projectRoot, options.outDir),
      source: stateDir,
      outRoot
    };
  }

  const runDir = resolveRunDirectory(projectRoot, outRoot, options.findingRunId);
  const [findings, meta] = await Promise.all([
    readJson<StructuredFinding[]>(path.join(runDir, "findings.json")),
    readJson<AuditMeta>(path.join(runDir, "meta.json"))
  ]);
  if (!Array.isArray(findings)) {
    throw new RepoVistaError(`Could not read RepoVista findings for run ${options.findingRunId}: findings.json is missing or invalid.`);
  }
  return {
    findings,
    source: path.join(runDir, "findings.json"),
    repository: meta?.source?.type === "github" ? meta.source.repository : undefined,
    outRoot,
    runDir
  };
}

function selectGithubStatusFindings(findings: StructuredFinding[], options: AuditOptions): StructuredFinding[] {
  const ids = findingIds(options);
  if (ids.length) {
    const byId = new Map(findings.map((finding) => [finding.id, finding]));
    const selected = ids.map((id) => byId.get(id)).filter((finding): finding is StructuredFinding => Boolean(finding));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
      throw new RepoVistaError(`Finding not found: ${missing.join(", ")}`);
    }
    return selected;
  }
  return options.allFindings ? findings : findings.filter(hasGithubLink);
}

async function syncGithubStatusForFinding(input: {
  finding: StructuredFinding;
  repository?: string;
  cwd: string;
  now: Date;
  exec: ExecFileAsync;
}): Promise<{ finding: StructuredFinding; changed: boolean; messages: string[] }> {
  let next = input.finding;
  const commands: string[] = [];
  const messages: string[] = [];

  if (input.finding.issue?.url || input.finding.issue?.number) {
    const result = await refreshIssueStatus(input.finding.issue, input.repository, input.cwd, input.exec, input.now);
    next = { ...next, issue: result.link };
    commands.push(result.command);
    messages.push(result.message);
  }

  if (input.finding.pullRequest?.url || input.finding.pullRequest?.number) {
    const result = await refreshPullRequestStatus(input.finding.pullRequest, input.repository, input.cwd, input.exec, input.now);
    next = { ...next, pullRequest: result.link };
    commands.push(result.command);
    messages.push(result.message);
  }

  if (!commands.length) {
    return {
      finding: input.finding,
      changed: false,
      messages: ["skipped, no linked GitHub issue or pull request"]
    };
  }

  return {
    finding: {
      ...next,
      updatedAt: input.now.toISOString(),
      history: [
        ...(input.finding.history ?? []),
        {
          kind: "github-status-sync",
          status: input.finding.status ?? "open",
          note: messages.join("; "),
          commands,
          createdAt: input.now.toISOString()
        }
      ]
    },
    changed: true,
    messages
  };
}

async function refreshIssueStatus(
  link: FindingIssueLink,
  fallbackRepository: string | undefined,
  cwd: string,
  exec: ExecFileAsync,
  now: Date
): Promise<{ link: FindingIssueLink; message: string; command: string }> {
  const parsed = githubReferenceForLink(link.url);
  const repository = link.repository ?? parsed?.repository ?? fallbackRepository;
  const number = link.number ?? (parsed?.kind === "issue" ? parsed.number : undefined);
  const command = "gh issue view";
  if (!repository || !number) {
    const error = "missing GitHub issue repository or number";
    return {
      command,
      message: `issue unknown (${error})`,
      link: failedIssueLink(link, repository, number, error, now)
    };
  }

  try {
    const { stdout } = await exec("gh", [
      "issue",
      "view",
      String(number),
      "-R",
      repository,
      "--json",
      "number,title,url,state,stateReason,labels,assignees,updatedAt,closedAt"
    ], { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER });
    const data = parseGhJson(stdout);
    const refreshed: FindingIssueLink = {
      ...link,
      provider: "github",
      repository,
      number: numberFrom(data.number) ?? number,
      url: stringFrom(data.url) ?? link.url,
      title: stringFrom(data.title) ?? link.title,
      state: normalizeIssueState(data.state),
      stateReason: normalizeIssueStateReason(data.stateReason),
      labels: namesFrom(data.labels),
      assignees: loginsFrom(data.assignees),
      updatedAt: stringFrom(data.updatedAt),
      closedAt: stringFrom(data.closedAt),
      syncedAt: now.toISOString(),
      lastStatusCheckAt: now.toISOString(),
      lastStatusError: undefined
    };
    return {
      command,
      message: `issue ${issueStatusLabel(refreshed)}`,
      link: refreshed
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      command,
      message: `issue unknown (${message})`,
      link: failedIssueLink(link, repository, number, message, now)
    };
  }
}

async function refreshPullRequestStatus(
  link: FindingPullRequestLink,
  fallbackRepository: string | undefined,
  cwd: string,
  exec: ExecFileAsync,
  now: Date
): Promise<{ link: FindingPullRequestLink; message: string; command: string }> {
  const parsed = githubReferenceForLink(link.url);
  const repository = link.repository ?? parsed?.repository ?? fallbackRepository;
  const number = link.number ?? (parsed?.kind === "pull" ? parsed.number : undefined);
  const command = "gh pr view";
  if (!repository || !number) {
    const error = "missing GitHub pull request repository or number";
    return {
      command,
      message: `PR unknown (${error})`,
      link: failedPullRequestLink(link, repository, number, error, now)
    };
  }

  try {
    const { stdout } = await exec("gh", [
      "pr",
      "view",
      String(number),
      "-R",
      repository,
      "--json",
      "number,title,url,state,isDraft,mergedAt,closedAt,mergeStateStatus,headRefName,baseRefName,updatedAt"
    ], { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER });
    const data = parseGhJson(stdout);
    const refreshed: FindingPullRequestLink = {
      ...link,
      provider: "github",
      repository,
      number: numberFrom(data.number) ?? number,
      url: stringFrom(data.url) ?? link.url,
      title: stringFrom(data.title) ?? link.title,
      state: normalizePullRequestState(data.state, data.mergedAt),
      isDraft: booleanFrom(data.isDraft),
      mergeStateStatus: stringFrom(data.mergeStateStatus),
      headRefName: stringFrom(data.headRefName),
      baseRefName: stringFrom(data.baseRefName),
      branch: link.branch ?? stringFrom(data.headRefName),
      updatedAt: stringFrom(data.updatedAt),
      closedAt: stringFrom(data.closedAt),
      mergedAt: stringFrom(data.mergedAt),
      syncedAt: now.toISOString(),
      lastStatusCheckAt: now.toISOString(),
      lastStatusError: undefined
    };
    return {
      command,
      message: `PR ${pullRequestStatusLabel(refreshed)}`,
      link: refreshed
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      command,
      message: `PR unknown (${message})`,
      link: failedPullRequestLink(link, repository, number, message, now)
    };
  }
}

async function persistGithubStatusUpdates(
  projectRoot: string,
  outDir: string,
  context: GithubStatusContext,
  updates: Map<string, StructuredFinding>
): Promise<void> {
  if (!updates.size) {
    return;
  }

  const updatedFindings = context.findings.map((finding) => updates.get(finding.id) ?? finding);
  if (context.runDir) {
    await writeFile(path.join(context.runDir, "findings.json"), `${JSON.stringify(updatedFindings, null, 2)}\n`, "utf8");
  }

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

function failedIssueLink(
  link: FindingIssueLink,
  repository: string | undefined,
  number: number | undefined,
  error: string,
  now: Date
): FindingIssueLink {
  return {
    ...link,
    provider: "github",
    repository,
    number,
    state: "unknown",
    syncedAt: now.toISOString(),
    lastStatusCheckAt: now.toISOString(),
    lastStatusError: error
  };
}

function failedPullRequestLink(
  link: FindingPullRequestLink,
  repository: string | undefined,
  number: number | undefined,
  error: string,
  now: Date
): FindingPullRequestLink {
  return {
    ...link,
    provider: "github",
    repository,
    number,
    state: "unknown",
    syncedAt: now.toISOString(),
    lastStatusCheckAt: now.toISOString(),
    lastStatusError: error
  };
}

function issueStatusLabel(link: FindingIssueLink): string {
  if (link.state === "closed" && link.stateReason) {
    return `closed/${link.stateReason}`;
  }
  return link.state ?? "unknown";
}

function pullRequestStatusLabel(link: FindingPullRequestLink): string {
  if (link.state === "merged") {
    return "merged";
  }
  if (link.state === "open" && link.isDraft) {
    return "draft";
  }
  return link.state ?? "unknown";
}

function hasGithubLink(finding: StructuredFinding): boolean {
  return Boolean(finding.issue?.url || finding.issue?.number || finding.pullRequest?.url || finding.pullRequest?.number);
}

function findingIds(options: AuditOptions): string[] {
  return (options.findingId ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function resolveRunDirectory(projectRoot: string, outRoot: string, value: string): string {
  const candidate = value.includes("/") || value.startsWith(".")
    ? path.resolve(projectRoot, value)
    : path.join(outRoot, value);
  const relative = path.relative(outRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RepoVistaError(`Run path must be inside ${outRoot}: ${value}`);
  }
  return candidate;
}

function githubReferenceForLink(url: string | undefined): { repository: string; kind: "issue" | "pull"; number: number } | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return undefined;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const kind = parts[2] === "issues" ? "issue" : parts[2] === "pull" ? "pull" : undefined;
    const number = Number(parts[3]);
    if (!parts[0] || !parts[1] || !kind || !Number.isInteger(number)) {
      return undefined;
    }
    return {
      repository: `${parts[0]}/${parts[1].replace(/\.git$/, "")}`,
      kind,
      number
    };
  } catch {
    return undefined;
  }
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function parseGhJson(stdout: string): Record<string, unknown> {
  const parsed = JSON.parse(stdout || "{}") as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function normalizeIssueState(value: unknown): FindingIssueLink["state"] {
  const normalized = token(value);
  if (normalized === "open" || normalized === "closed") {
    return normalized;
  }
  return "unknown";
}

function normalizeIssueStateReason(value: unknown): FindingIssueLink["stateReason"] | undefined {
  const normalized = token(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized === "not_planned" || normalized === "not-planned") {
    return "not-planned";
  }
  if (normalized === "completed" || normalized === "reopened") {
    return normalized;
  }
  return "unknown";
}

function normalizePullRequestState(value: unknown, mergedAt: unknown): FindingPullRequestLink["state"] {
  if (stringFrom(mergedAt)) {
    return "merged";
  }
  const normalized = token(value);
  if (normalized === "open" || normalized === "closed") {
    return normalized;
  }
  if (normalized === "merged") {
    return "merged";
  }
  return "unknown";
}

function token(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase().replace(/\s+/g, "-") : undefined;
}

function namesFrom(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => item && typeof item === "object" && "name" in item ? stringFrom((item as { name?: unknown }).name) : undefined)
    .filter((item): item is string => Boolean(item));
}

function loginsFrom(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => item && typeof item === "object" && "login" in item ? stringFrom((item as { login?: unknown }).login) : undefined)
    .filter((item): item is string => Boolean(item));
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function booleanFrom(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return maskSensitiveText(error.message);
  }
  return maskSensitiveText(String(error));
}
