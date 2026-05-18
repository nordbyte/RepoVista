import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createIgnoreMatcher, normalizeRelative } from "./ignore.js";
import { languageForPath } from "./work-partitioner.js";
import type { ProjectFileSummary } from "./types.js";

export interface ProjectScanOptions {
  outDir: string;
  includes: string[];
  ignores: string[];
  maxFiles?: number;
}

export interface ProjectScanResult {
  files: ProjectFileSummary[];
  directories: string[];
  omittedFileCount: number;
  truncated: boolean;
  maxFiles: number;
}

const DEFAULT_MAX_SCAN_FILES = 30_000;
const MAX_HASH_BYTES = 1024 * 1024;

export async function scanProject(projectRoot: string, options: ProjectScanOptions): Promise<ProjectScanResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_SCAN_FILES;
  const matcher = createIgnoreMatcher({
    projectRoot,
    outDir: options.outDir,
    includePatterns: options.includes,
    ignorePatterns: options.ignores
  });
  const state = {
    files: [] as ProjectFileSummary[],
    directories: new Set<string>(),
    omittedFileCount: 0,
    truncated: false
  };

  await walkProject(projectRoot, "", matcher.shouldIgnore, state, maxFiles);
  return {
    files: state.files,
    directories: Array.from(state.directories).sort(),
    omittedFileCount: state.omittedFileCount,
    truncated: state.truncated,
    maxFiles
  };
}

async function walkProject(
  root: string,
  relativeDirectory: string,
  shouldIgnore: (relativePath: string, isDirectory: boolean) => boolean,
  state: {
    files: ProjectFileSummary[];
    directories: Set<string>;
    omittedFileCount: number;
    truncated: boolean;
  },
  maxFiles: number
): Promise<void> {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  for (const entry of entries) {
    const relativePath = normalizeRelative(path.join(relativeDirectory, entry.name));
    if (shouldIgnore(relativePath, entry.isDirectory())) {
      state.omittedFileCount += entry.isDirectory() ? 0 : 1;
      continue;
    }

    const absolutePath = path.join(root, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      state.directories.add(relativePath);
      await walkProject(root, relativePath, shouldIgnore, state, maxFiles);
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    if (state.files.length >= maxFiles) {
      state.omittedFileCount += 1;
      state.truncated = true;
      continue;
    }

    const contentHash = stats.size <= MAX_HASH_BYTES ? await fileSha256(absolutePath) : undefined;
    state.files.push({
      relativePath,
      extension: path.extname(relativePath).toLowerCase(),
      size: stats.size,
      language: languageForPath(relativePath),
      mtimeMs: Math.round(stats.mtimeMs),
      hashAlgorithm: contentHash ? "sha256" : undefined,
      sha256: contentHash,
      scopeReason: "matched repository scan include/ignore settings"
    });
  }
}

async function fileSha256(filePath: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}
