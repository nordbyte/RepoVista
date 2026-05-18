import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AuditOptions, WorkspaceDetectionResult, WorkspaceInfo } from "./types.js";

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
  for (const pattern of patterns) {
    if (pattern.includes("**")) {
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
        const workspace = await workspaceFromPath(projectRoot, relativePath, packageManager, pattern);
        if (workspace) {
          workspaces.push(workspace);
        }
      }
      continue;
    }
    const workspace = await workspaceFromPath(projectRoot, normalizePath(pattern), packageManager, pattern);
    if (workspace) {
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
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name?: string };
    return {
      name: parsed.name ?? relativePath,
      path: relativePath,
      packageManager,
      packageJsonPath: normalizePath(path.relative(projectRoot, packageJsonPath)),
      patterns: [pattern]
    };
  } catch {
    return undefined;
  }
}

function dedupeWorkspaces(workspaces: WorkspaceInfo[]): WorkspaceInfo[] {
  const byPath = new Map<string, WorkspaceInfo>();
  for (const workspace of workspaces) {
    const existing = byPath.get(workspace.path);
    if (existing) {
      existing.patterns = Array.from(new Set([...existing.patterns, ...workspace.patterns]));
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
