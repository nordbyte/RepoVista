import { runProcess } from "./process-runner.js";
import type { CommandRunner } from "./evidence.js";
import type { EvidencePack, RepositoryDriftState, RepositoryGitSnapshot } from "./types.js";

const GIT_TIMEOUT_SECONDS = 10;

export async function collectRepositoryGitSnapshot(
  projectRoot: string,
  runCommand?: CommandRunner,
  now = new Date(),
  ignoredStatusPaths: string[] = []
): Promise<RepositoryGitSnapshot> {
  const command = runCommand ?? defaultRunCommand;
  const inside = await command("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    timeoutSeconds: GIT_TIMEOUT_SECONDS
  });
  if (inside.exitCode !== 0 || inside.stdout?.trim() !== "true") {
    return {
      available: false,
      capturedAt: now.toISOString(),
      error: inside.error ?? inside.stderr
    };
  }

  const [branch, commit, status] = await Promise.all([
    command("git", ["branch", "--show-current"], { cwd: projectRoot, timeoutSeconds: GIT_TIMEOUT_SECONDS }),
    command("git", ["rev-parse", "HEAD"], { cwd: projectRoot, timeoutSeconds: GIT_TIMEOUT_SECONDS }),
    command("git", ["status", "--short"], { cwd: projectRoot, timeoutSeconds: GIT_TIMEOUT_SECONDS })
  ]);
  const statusShort = filterIgnoredStatusPaths(
    status.stdout?.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean) ?? [],
    ignoredStatusPaths
  );
  return {
    available: true,
    capturedAt: now.toISOString(),
    branch: cleanOutput(branch.stdout),
    commit: cleanOutput(commit.stdout),
    dirty: statusShort.length > 0,
    statusShort
  };
}

export function gitSnapshotFromEvidence(
  evidence: EvidencePack,
  now = new Date(evidence.collectedAt),
  ignoredStatusPaths: string[] = []
): RepositoryGitSnapshot | undefined {
  if (!evidence.git.available) {
    return {
      available: false,
      capturedAt: now.toISOString(),
      error: evidence.git.error
    };
  }
  const statusShort = filterIgnoredStatusPaths(evidence.git.statusShort ?? [], ignoredStatusPaths);
  return {
    available: true,
    capturedAt: now.toISOString(),
    branch: evidence.git.branch,
    commit: evidence.git.commit,
    dirty: evidence.git.statusShort ? statusShort.length > 0 : evidence.git.dirty,
    statusShort
  };
}

export function createInitialRepositoryDriftState(initial: RepositoryGitSnapshot | undefined): RepositoryDriftState {
  return {
    initial,
    detected: false,
    warnings: []
  };
}

export function detectRepositoryDrift(
  initial: RepositoryGitSnapshot | undefined,
  current: RepositoryGitSnapshot,
  previous?: RepositoryDriftState
): RepositoryDriftState {
  const warnings = driftWarnings(initial, current);
  return {
    initial,
    current,
    detected: warnings.length > 0,
    detectedAt: warnings.length > 0 ? previous?.detectedAt ?? current.capturedAt : previous?.detectedAt,
    warnings
  };
}

export function primaryRepositoryDriftWarning(state: RepositoryDriftState | undefined): string | undefined {
  return state?.warnings[0];
}

function driftWarnings(initial: RepositoryGitSnapshot | undefined, current: RepositoryGitSnapshot): string[] {
  if (!initial?.available) {
    return [];
  }
  if (!current.available) {
    return [`Repository state changed during audit: git state became unavailable${current.error ? ` (${current.error})` : ""}.`];
  }

  const changes: string[] = [];
  if (initial.branch && current.branch && initial.branch !== current.branch) {
    changes.push(`branch ${initial.branch} -> ${current.branch}`);
  }
  if (initial.commit && current.commit && initial.commit !== current.commit) {
    changes.push(`commit ${shortSha(initial.commit)} -> ${shortSha(current.commit)}`);
  }
  const initialStatus = normalizeStatus(initial.statusShort);
  const currentStatus = normalizeStatus(current.statusShort);
  if (initialStatus !== currentStatus) {
    const before = initial.statusShort?.length ? `${initial.statusShort.length} dirty path(s)` : "clean";
    const after = current.statusShort?.length ? `${current.statusShort.length} dirty path(s)` : "clean";
    changes.push(`working tree ${before} -> ${after}`);
  }
  if (!changes.length) {
    return [];
  }
  return [`Repository changed during audit: ${changes.join("; ")}. Revalidate findings before acting on them.`];
}

function normalizeStatus(value: string[] | undefined): string {
  return (value ?? []).map((line) => line.trimEnd()).sort().join("\n");
}

function filterIgnoredStatusPaths(statusShort: string[], ignoredStatusPaths: string[]): string[] {
  const ignored = ignoredStatusPaths
    .map((item) => item.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, ""))
    .filter(Boolean);
  if (!ignored.length) {
    return statusShort;
  }
  return statusShort.filter((line) => {
    const paths = statusLinePaths(line);
    return !paths.length || paths.some((item) => !isIgnoredStatusPath(item, ignored));
  });
}

function statusLinePaths(line: string): string[] {
  const value = line.length > 3 ? line.slice(3).trim() : line.trim();
  if (!value) {
    return [];
  }
  return value.split(" -> ").map((item) => item.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, ""));
}

function isIgnoredStatusPath(value: string, ignored: string[]): boolean {
  return ignored.some((item) => value === item || value.startsWith(`${item}/`));
}

function cleanOutput(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function shortSha(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function defaultRunCommand(command: string, args: string[], options: Parameters<CommandRunner>[2]): ReturnType<CommandRunner> {
  return runProcess(command, args, {
    cwd: options.cwd,
    shell: options.shell,
    timeoutMs: options.timeoutSeconds * 1000,
    stdoutLimit: 1024 * 1024,
    stderrLimit: 1024 * 1024
  }).then((result) => ({
    command: result.renderedCommand,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    stdout: result.stdout.trim() || undefined,
    stderr: result.stderr.trim() || undefined,
    error: result.error
  }));
}
