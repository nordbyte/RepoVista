import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PreflightError } from "./errors.js";
import { runProcess } from "./process-runner.js";
import type { AuditSnapshotMeta } from "./types.js";

const GIT_TIMEOUT_MS = 30_000;

export interface PreparedAuditSnapshot {
  meta: AuditSnapshotMeta;
  cleanup(): Promise<void>;
}

export async function prepareAuditSnapshot(
  originalRoot: string,
  runDir: string,
  ignoredStatusPaths: string[] = [],
  now = new Date()
): Promise<PreparedAuditSnapshot> {
  const inside = await git(originalRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    throw new PreflightError("Snapshot audits require a Git work tree.");
  }

  const [commit, branch, status, dirtyPatch, untracked] = await Promise.all([
    git(originalRoot, ["rev-parse", "HEAD"]),
    git(originalRoot, ["branch", "--show-current"]),
    git(originalRoot, ["status", "--short"]),
    git(originalRoot, ["diff", "--binary", "HEAD"]),
    git(originalRoot, ["ls-files", "--others", "--exclude-standard"])
  ]);
  if (commit.exitCode !== 0 || !commit.stdout.trim()) {
    throw new PreflightError(`Could not resolve Git HEAD for snapshot audit: ${commit.stderr || commit.error || "unknown error"}`);
  }

  const statusShort = filterIgnoredStatus(status.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean), ignoredStatusPaths);
  const patchText = dirtyPatch.stdout.trim();
  const untrackedText = untracked.stdout.trim();
  const dirty = statusShort.length > 0;
  const patchPath = patchText ? path.join(runDir, "snapshot-dirty.patch") : undefined;
  const untrackedPath = untrackedText ? path.join(runDir, "snapshot-untracked-files.txt") : undefined;
  if (patchPath) {
    await writeFile(patchPath, `${patchText}\n`, "utf8");
  }
  if (untrackedPath) {
    await writeFile(untrackedPath, `${untrackedText}\n`, "utf8");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "repovista-snapshot-"));
  const analysisRoot = path.join(tempRoot, "worktree");
  const add = await git(originalRoot, ["worktree", "add", "--detach", analysisRoot, commit.stdout.trim()]);
  if (add.exitCode !== 0) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    throw new PreflightError(`Could not create snapshot worktree: ${add.stderr || add.error || "unknown error"}`);
  }

  const meta: AuditSnapshotMeta = {
    enabled: true,
    originalRoot,
    analysisRoot,
    commit: commit.stdout.trim(),
    branch: branch.stdout.trim() || undefined,
    dirty,
    statusShort,
    patchPath,
    untrackedPath,
    createdAt: now.toISOString(),
    cleanupStatus: "pending",
    warnings: [
      ...(dirty ? ["Original checkout had uncommitted changes; snapshot analysis used HEAD only. Dirty tracked changes were saved when available."] : []),
      ...(untrackedText ? ["Original checkout had untracked files; snapshot analysis excluded them and saved their paths."] : [])
    ]
  };

  return {
    meta,
    cleanup: async () => {
      const removed = await git(originalRoot, ["worktree", "remove", "--force", analysisRoot]);
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      meta.cleanupStatus = removed.exitCode === 0 ? "removed" : "failed";
      if (removed.exitCode !== 0) {
        meta.warnings.push(`Could not remove snapshot worktree cleanly: ${removed.stderr || removed.error || "unknown error"}`);
      }
    }
  };
}

async function git(cwd: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string; error?: string }> {
  return runProcess("git", args, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    stdoutLimit: 2 * 1024 * 1024,
    stderrLimit: 2 * 1024 * 1024
  });
}

function filterIgnoredStatus(statusShort: string[], ignoredStatusPaths: string[]): string[] {
  const ignored = ignoredStatusPaths
    .map((item) => item.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, ""))
    .filter(Boolean);
  if (!ignored.length) {
    return statusShort;
  }
  return statusShort.filter((line) => {
    const value = line.length > 3 ? line.slice(3).trim() : line.trim();
    const paths = value.split(" -> ").map((item) => item.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, ""));
    return !paths.length || paths.some((item) => !ignored.some((ignoredPath) => item === ignoredPath || item.startsWith(`${ignoredPath}/`)));
  });
}
