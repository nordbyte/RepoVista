import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { PreflightError } from "./errors.js";
import { runProcess } from "./process-runner.js";
import type { CommandRunner } from "./evidence.js";
import type { AuditOptions, GithubSourceInfo } from "./types.js";

export interface NormalizedGithubRepository {
  owner: string;
  repo: string;
  repository: string;
  url: string;
}

export interface GithubSourceDependencies {
  runCommand?: CommandRunner;
  now?: Date;
}

const GITHUB_HOST = "github.com";
const GIT_TIMEOUT_SECONDS = 300;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const FULL_SHA_PATTERN = /^[a-fA-F0-9]{40}$/;

export function normalizeGithubRepository(input: string): NormalizedGithubRepository {
  const value = input.trim();
  if (!value) {
    throw new PreflightError("Option --github-repo requires a GitHub repository.");
  }

  const shorthand = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(value);
  if (shorthand) {
    return normalizedRepository(shorthand[1], shorthand[2]);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PreflightError("Option --github-repo must be owner/repo or https://github.com/owner/repo.");
  }

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== GITHUB_HOST) {
    throw new PreflightError("Option --github-repo only supports public https://github.com/owner/repo URLs.");
  }
  if (parsed.username || parsed.password) {
    throw new PreflightError("Option --github-repo must not include credentials or tokens.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new PreflightError("Option --github-repo URL must point to a repository root, not a subpath.");
  }
  return normalizedRepository(segments[0], segments[1].replace(/\.git$/, ""));
}

export function validateGithubRef(value: string | undefined): string | undefined {
  const ref = value?.trim();
  if (!ref) {
    return undefined;
  }
  if (
    ref.length > 200 ||
    ref.startsWith("-") ||
    ref.includes("..") ||
    ref.includes("\\") ||
    /[\u0000-\u001f\u007f\s~^:?*\[\]\\]/.test(ref)
  ) {
    throw new PreflightError("Option --github-ref must be a safe branch, tag, or full commit SHA.");
  }
  return ref;
}

export async function prepareGithubSource(
  outputProjectRoot: string,
  outRoot: string,
  options: AuditOptions,
  dependencies: GithubSourceDependencies = {}
): Promise<GithubSourceInfo | undefined> {
  if (!options.githubRepo) {
    if (options.githubRef) {
      throw new PreflightError("Option --github-ref requires --github-repo.");
    }
    return undefined;
  }
  if (options.resumeDir) {
    throw new PreflightError("Option --github-repo cannot be combined with --resume.");
  }

  const repository = normalizeGithubRepository(options.githubRepo);
  const ref = validateGithubRef(options.githubRef);
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const now = dependencies.now ?? new Date();
  const remote = ref
    ? await resolveRequestedRef(outputProjectRoot, repository.url, ref, runCommand)
    : await resolveDefaultRef(outputProjectRoot, repository.url, runCommand);
  const cloneDir = path.join(outRoot, "sources", "github", repository.owner, repository.repo, remote.commit.slice(0, 12));

  await ensureGithubClone(outputProjectRoot, repository.url, cloneDir, remote, runCommand);
  const head = await git(outputProjectRoot, ["rev-parse", "HEAD"], runCommand, cloneDir);
  const commit = cleanGitOutput(head.stdout);
  if (!FULL_SHA_PATTERN.test(commit)) {
    throw new PreflightError(`Could not verify cloned GitHub repository commit for ${repository.repository}.`);
  }

  return {
    type: "github",
    repository: repository.repository,
    owner: repository.owner,
    repo: repository.repo,
    url: repository.url,
    ref,
    defaultBranch: remote.defaultBranch,
    commit,
    cloneDir,
    fetchedAt: now.toISOString()
  };
}

interface ResolvedRemoteRef {
  ref?: string;
  defaultBranch?: string;
  commit: string;
  fullSha: boolean;
}

async function resolveDefaultRef(cwd: string, url: string, runCommand: CommandRunner): Promise<ResolvedRemoteRef> {
  const result = await git(cwd, ["ls-remote", "--symref", url, "HEAD"], runCommand);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const symref = lines.find((line) => line.startsWith("ref: "));
  const defaultBranch = symref?.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/)?.[1];
  const commit = cleanGitOutput(
    lines
      .map((line) => line.split(/\s+/)[0] ?? "")
      .find((value) => FULL_SHA_PATTERN.test(value)) ?? ""
  );
  if (!FULL_SHA_PATTERN.test(commit)) {
    throw new PreflightError(`Could not resolve default branch for ${url}.`);
  }
  return {
    ref: defaultBranch,
    defaultBranch,
    commit,
    fullSha: false
  };
}

async function resolveRequestedRef(cwd: string, url: string, ref: string, runCommand: CommandRunner): Promise<ResolvedRemoteRef> {
  if (FULL_SHA_PATTERN.test(ref)) {
    return {
      ref,
      commit: ref.toLowerCase(),
      fullSha: true
    };
  }

  const result = await git(cwd, [
    "ls-remote",
    url,
    ref,
    `refs/heads/${ref}`,
    `refs/tags/${ref}`,
    `refs/tags/${ref}^{}`
  ], runCommand);
  const records = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, name] = line.split(/\s+/);
      return { commit, name };
    });
  const peeledTag = records.find((record) => record.name === `refs/tags/${ref}^{}`);
  const branch = records.find((record) => record.name === `refs/heads/${ref}`);
  const tag = records.find((record) => record.name === `refs/tags/${ref}`);
  const fallback = records[0];
  const selected = peeledTag ?? branch ?? tag ?? fallback;
  if (!selected || !FULL_SHA_PATTERN.test(selected.commit)) {
    throw new PreflightError(`Could not resolve GitHub ref ${ref} for ${url}.`);
  }
  return {
    ref,
    commit: selected.commit.toLowerCase(),
    fullSha: false
  };
}

async function ensureGithubClone(
  cwd: string,
  url: string,
  cloneDir: string,
  remote: ResolvedRemoteRef,
  runCommand: CommandRunner
): Promise<void> {
  if (await cloneMatches(cloneDir, remote.commit, runCommand)) {
    return;
  }

  await rm(cloneDir, { recursive: true, force: true });
  await mkdir(path.dirname(cloneDir), { recursive: true });

  if (remote.fullSha) {
    await git(cwd, ["clone", "--filter=blob:none", "--no-checkout", url, cloneDir], runCommand);
    await git(cwd, ["fetch", "--depth=1", "origin", remote.commit], runCommand, cloneDir);
    await git(cwd, ["checkout", "--detach", remote.commit], runCommand, cloneDir);
    return;
  }

  const args = remote.ref
    ? ["clone", "--depth=1", "--single-branch", "--branch", remote.ref, url, cloneDir]
    : ["clone", "--depth=1", "--no-tags", url, cloneDir];
  await git(cwd, args, runCommand);
}

async function cloneMatches(cloneDir: string, commit: string, runCommand: CommandRunner): Promise<boolean> {
  try {
    const dir = await stat(cloneDir);
    if (!dir.isDirectory()) {
      return false;
    }
    const head = await git(cloneDir, ["rev-parse", "HEAD"], runCommand, cloneDir);
    return cleanGitOutput(head.stdout).toLowerCase() === commit.toLowerCase();
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[], runCommand: CommandRunner, commandCwd = cwd): Promise<{ stdout: string; stderr?: string; error?: string }> {
  const result = await runCommand("git", args, {
    cwd: commandCwd,
    timeoutSeconds: GIT_TIMEOUT_SECONDS
  });
  if (result.exitCode !== 0) {
    throw new PreflightError(`GitHub repository fetch failed: git ${args.join(" ")}: ${result.error ?? result.stderr ?? "unknown error"}`);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr,
    error: result.error
  };
}

function normalizedRepository(owner: string, repo: string): NormalizedGithubRepository {
  const cleanRepo = repo.replace(/\.git$/, "");
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(cleanRepo) || cleanRepo === "." || cleanRepo === "..") {
    throw new PreflightError("Option --github-repo must identify a valid GitHub owner/repo.");
  }
  const repository = `${owner}/${cleanRepo}`;
  return {
    owner,
    repo: cleanRepo,
    repository,
    url: `https://github.com/${repository}.git`
  };
}

function cleanGitOutput(value: string): string {
  return value.trim();
}

function defaultRunCommand(command: string, args: string[], options: Parameters<CommandRunner>[2]): ReturnType<CommandRunner> {
  return runProcess(command, args, {
    cwd: options.cwd,
    shell: options.shell,
    timeoutMs: options.timeoutSeconds * 1000,
    stdoutLimit: 2 * 1024 * 1024,
    stderrLimit: 2 * 1024 * 1024
  }).then((result) => ({
    command: result.renderedCommand,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error
  }));
}
