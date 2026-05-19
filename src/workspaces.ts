import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AuditOptions, WorkspaceDetectionResult, WorkspaceInfo } from "./types.js";

const MAX_GLOBSTAR_DEPTH = 6;
const SKIPPED_WORKSPACE_DIRS = new Set([".git", ".repovista", "node_modules", "dist", "build", "coverage"]);

export async function detectWorkspaces(projectRoot: string): Promise<WorkspaceDetectionResult> {
  const warnings: string[] = [];
  const workspaces: WorkspaceInfo[] = [];
  const packageJsonWorkspaces = await detectPackageJsonWorkspaces(projectRoot, warnings);
  const pnpmWorkspaces = await detectPnpmWorkspaces(projectRoot, warnings);
  workspaces.push(...packageJsonWorkspaces, ...pnpmWorkspaces);
  const deduped = dedupeWorkspaces(workspaces);
  return {
    detected: deduped.length > 0,
    allWorkspaces: false,
    workspaces: deduped,
    warnings
  };
}

export async function resolveWorkspaceScope(projectRoot: string, options: AuditOptions): Promise<WorkspaceDetectionResult> {
  const result = await detectWorkspaces(projectRoot);
  result.allWorkspaces = Boolean(options.allWorkspaces);
  if (!options.workspace) {
    return result;
  }

  const normalized = normalizeWorkspaceSelector(options.workspace);
  const selected = result.workspaces.find((workspace) =>
    normalizeWorkspaceSelector(workspace.name) === normalized ||
    normalizeWorkspaceSelector(workspace.path) === normalized
  );
  if (!selected) {
    result.warnings.push(`Workspace was requested but not detected: ${options.workspace}`);
    result.selected = options.workspace;
    return result;
  }
  result.selected = selected.path;
  return result;
}

export function workspaceIncludes(options: AuditOptions, workspace: WorkspaceDetectionResult): string[] {
  if (!workspace.selected) {
    return options.includes;
  }
  const selected = workspace.workspaces.find((item) => item.path === workspace.selected || item.name === workspace.selected);
  if (!selected) {
    return options.includes;
  }
  return Array.from(new Set([
    ...options.includes,
    selected.path,
    `${selected.path}/**`
  ]));
}

async function detectPackageJsonWorkspaces(projectRoot: string, warnings: string[]): Promise<WorkspaceInfo[]> {
  const packageJsonPath = path.join(projectRoot, "package.json");
  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      workspaces?: string[] | { packages?: string[] };
      packageManager?: string;
    };
    const patterns = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
      : Array.isArray(parsed.workspaces?.packages)
        ? parsed.workspaces.packages
        : [];
    return expandWorkspacePatterns(projectRoot, patterns, parsed.packageManager ?? "npm");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") {
      warnings.push(`Could not read package.json workspaces: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}

async function detectPnpmWorkspaces(projectRoot: string, warnings: string[]): Promise<WorkspaceInfo[]> {
  const filePath = path.join(projectRoot, "pnpm-workspace.yaml");
  try {
    const content = await readFile(filePath, "utf8");
    const patterns = parsePnpmWorkspacePatterns(content);
    return expandWorkspacePatterns(projectRoot, patterns, "pnpm");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") {
      warnings.push(`Could not read pnpm-workspace.yaml: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}

function parsePnpmWorkspacePatterns(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*packages\s*:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) {
      inPackages = false;
    }
    if (!inPackages) {
      continue;
    }
    const match = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/.exec(line);
    if (match?.[1]) {
      patterns.push(match[1]);
    }
  }
  return patterns;
}

async function expandWorkspacePatterns(projectRoot: string, patterns: string[], packageManager: string): Promise<WorkspaceInfo[]> {
  const workspaces: WorkspaceInfo[] = [];
  const includePatterns = patterns.map(normalizePath).filter((pattern) => pattern && !pattern.startsWith("!"));
  const excludeMatchers = patterns
    .map(normalizePath)
    .filter((pattern) => pattern.startsWith("!") && pattern.length > 1)
    .map((pattern) => globPatternToRegExp(pattern.slice(1)));
  const isExcluded = (relativePath: string) => excludeMatchers.some((matcher) => matcher.test(relativePath));

  for (const pattern of includePatterns) {
    if (pattern.includes("**")) {
      for (const relativePath of await globstarWorkspaceCandidates(projectRoot, pattern)) {
        if (isExcluded(relativePath)) {
          continue;
        }
        const workspace = await workspaceFromPath(projectRoot, relativePath, packageManager, pattern);
        if (workspace) {
          workspaces.push(workspace);
        }
      }
      continue;
    }
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2);
      const parentPath = path.join(projectRoot, parent);
      let entries;
      try {
        entries = await readdir(parentPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const relativePath = normalizePath(path.join(parent, entry.name));
        if (isExcluded(relativePath)) {
          continue;
        }
        const workspace = await workspaceFromPath(projectRoot, relativePath, packageManager, pattern);
        if (workspace) {
          workspaces.push(workspace);
        }
      }
      continue;
    }
    const workspace = await workspaceFromPath(projectRoot, normalizePath(pattern), packageManager, pattern);
    if (workspace && !isExcluded(workspace.path)) {
      workspaces.push(workspace);
    }
  }
  return workspaces;
}

async function workspaceFromPath(
  projectRoot: string,
  relativePath: string,
  packageManager: string,
  pattern: string
): Promise<WorkspaceInfo | undefined> {
  const packageJsonPath = path.join(projectRoot, relativePath, "package.json");
  try {
    const fileStat = await stat(packageJsonPath);
    if (!fileStat.isFile()) {
      return undefined;
    }
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const scripts = readStringRecord(parsed.scripts);
    const dependencies = dependencyNames(parsed);
    return {
      name: parsed.name ?? relativePath,
      path: relativePath,
      packageManager,
      packageJsonPath: normalizePath(path.relative(projectRoot, packageJsonPath)),
      patterns: [pattern],
      scripts,
      dependencies,
      validationCommands: validationCommandsForScripts(packageManager, scripts)
    };
  } catch {
    return undefined;
  }
}

async function globstarWorkspaceCandidates(projectRoot: string, pattern: string): Promise<string[]> {
  const matcher = globPatternToRegExp(pattern);
  const candidates: string[] = [];
  await walk(projectRoot, "", 0, async (relativePath) => {
    if (!matcher.test(relativePath)) {
      return;
    }
    try {
      const packageStat = await stat(path.join(projectRoot, relativePath, "package.json"));
      if (packageStat.isFile()) {
        candidates.push(relativePath);
      }
    } catch {
      // Only package directories are workspace candidates.
    }
  });
  return candidates.sort();
}

async function walk(projectRoot: string, relativePath: string, depth: number, visit: (relativePath: string) => Promise<void>): Promise<void> {
  if (depth > MAX_GLOBSTAR_DEPTH) {
    return;
  }
  if (relativePath) {
    await visit(relativePath);
  }
  let entries;
  try {
    entries = await readdir(path.join(projectRoot, relativePath), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIPPED_WORKSPACE_DIRS.has(entry.name)) {
      continue;
    }
    await walk(projectRoot, normalizePath(path.join(relativePath, entry.name)), depth + 1, visit);
  }
}

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("/")
    .map((segment) => {
      if (segment === "**") {
        return "(?:[^/]+/)*[^/]+";
      }
      return segment
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      record[key] = item;
    }
  }
  return Object.keys(record).length ? record : undefined;
}

function dependencyNames(parsed: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}): string[] {
  return Array.from(new Set([
    ...Object.keys(readStringRecord(parsed.dependencies) ?? {}),
    ...Object.keys(readStringRecord(parsed.devDependencies) ?? {}),
    ...Object.keys(readStringRecord(parsed.peerDependencies) ?? {}),
    ...Object.keys(readStringRecord(parsed.optionalDependencies) ?? {})
  ])).sort();
}

function validationCommandsForScripts(packageManager: string, scripts: Record<string, string> | undefined): string[] {
  if (!scripts) {
    return [];
  }
  const prefix = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm run";
  return ["typecheck", "lint", "test", "build"]
    .filter((script) => scripts[script])
    .map((script) => prefix === "npm run" ? `${prefix} ${script}` : `${prefix} ${script}`);
}

function dedupeWorkspaces(workspaces: WorkspaceInfo[]): WorkspaceInfo[] {
  const byPath = new Map<string, WorkspaceInfo>();
  for (const workspace of workspaces) {
    const existing = byPath.get(workspace.path);
    if (existing) {
      existing.patterns = Array.from(new Set([...existing.patterns, ...workspace.patterns]));
      existing.validationCommands = Array.from(new Set([
        ...(existing.validationCommands ?? []),
        ...(workspace.validationCommands ?? [])
      ]));
      existing.dependencies = Array.from(new Set([
        ...(existing.dependencies ?? []),
        ...(workspace.dependencies ?? [])
      ])).sort();
      continue;
    }
    byPath.set(workspace.path, workspace);
  }
  return Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeWorkspaceSelector(value: string): string {
  return normalizePath(value).replace(/\/+$/g, "").toLowerCase();
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}
