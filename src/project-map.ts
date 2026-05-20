import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { syncFeatureRecords } from "./feature-state.js";
import { scanProject, type ProjectScanResult } from "./project-scan.js";
import { validateReportRoot } from "./reports.js";
import { buildSemanticFeatures } from "./semantic-features.js";
import { detectWorkspaces } from "./workspaces.js";
import {
  buildProjectAreas,
  createWorkShards,
  recommendParallelism,
  resolveParallelism
} from "./work-partitioner.js";
import type { AuditOptions, DiffScope, ParallelExecutionMeta, ParallelMode, ProjectFileSummary, ProjectMap } from "./types.js";

const PROJECT_MAP_VERSION = 1;
const MAX_PROJECT_MAP_FILES = 30_000;

export async function initializeProjectMap(
  projectRoot: string,
  options: AuditOptions,
  now = new Date()
): Promise<{ map: ProjectMap; mapPath: string }> {
  const map = await createProjectMap(projectRoot, options, now);
  const mapPath = await saveProjectMap(projectRoot, options, map);
  await syncFeatureRecords(projectRoot, options.outDir, map.features, "init", now);
  return { map, mapPath };
}

export async function saveProjectMap(
  projectRoot: string,
  options: AuditOptions,
  map: ProjectMap
): Promise<string> {
  const outRoot = await validateReportRoot(projectRoot, options.outDir);
  const mapPath = path.join(outRoot, "project-map.json");
  await mkdir(path.dirname(mapPath), { recursive: true });
  await writeProjectMap(mapPath, map);
  return mapPath;
}

export async function createProjectMap(
  projectRoot: string,
  options: AuditOptions,
  now = new Date(),
  since?: DiffScope,
  scan?: ProjectScanResult
): Promise<ProjectMap> {
  const projectScan = scan ?? await scanProject(projectRoot, {
    outDir: options.outDir,
    includes: options.includes,
    ignores: options.ignores,
    maxFiles: MAX_PROJECT_MAP_FILES
  });
  const files = projectScan.files;
  const packageJson = await readPackageJson(projectRoot);
  const workspaceDetection = await detectWorkspaces(projectRoot);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const languages = countLanguages(files);
  const areas = buildProjectAreas(files);
  const features = buildSemanticFeatures(files, areas, since, packageJson);
  const recommendedParallelism = recommendParallelism(files.length, totalBytes, areas);
  const warnings: string[] = [];
  if (files.length >= MAX_PROJECT_MAP_FILES) {
    warnings.push(`Project map was capped at ${MAX_PROJECT_MAP_FILES} files.`);
  }
  if (projectScan.truncated) {
    warnings.push(`Project scan was truncated after ${projectScan.maxFiles} files.`);
  }
  if (recommendedParallelism > 1) {
    warnings.push(`RepoVista recommends ${recommendedParallelism} parallel provider sessions for this repository shape.`);
  }
  warnings.push(...workspaceDetection.warnings);

  return {
    version: PROJECT_MAP_VERSION,
    projectRoot,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    outDir: options.outDir,
    fileCount: files.length,
    totalBytes,
    languages,
    frameworks: detectFrameworks(packageJson),
    packageManagers: detectPackageManagers(files),
    workspaces: workspaceDetection.workspaces,
    areas,
    features,
    recommendedParallelism,
    recommendedShards: createWorkShards(areas, recommendedParallelism, {
      workspaces: workspaceDetection.workspaces,
      changedFiles: since?.changedFiles ?? []
    }),
    since,
    warnings
  };
}

export async function loadProjectMap(projectRoot: string, outDir: string): Promise<{ map: ProjectMap; mapPath: string } | undefined> {
  const outRoot = await validateReportRoot(projectRoot, outDir);
  const mapPath = path.join(outRoot, "project-map.json");
  try {
    const raw = await readFile(mapPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectMap;
    if (parsed.version !== PROJECT_MAP_VERSION || !Array.isArray(parsed.areas)) {
      return undefined;
    }
    if (!Array.isArray(parsed.features)) {
      parsed.features = buildSemanticFeatures([], parsed.areas);
    }
    return { map: parsed, mapPath };
  } catch {
    return undefined;
  }
}

export async function checkProjectMapFreshness(
  projectRoot: string,
  options: AuditOptions,
  loaded: ProjectMap
): Promise<{ stale: boolean; warnings: string[]; current: ProjectMap }> {
  const current = await createProjectMap(projectRoot, options, new Date());
  const warnings: string[] = [];
  if (loaded.fileCount !== current.fileCount) {
    warnings.push(`file count changed from ${loaded.fileCount} to ${current.fileCount}`);
  }
  if (loaded.totalBytes !== current.totalBytes) {
    warnings.push(`scanned byte size changed from ${loaded.totalBytes} to ${current.totalBytes}`);
  }
  if (stableRecord(loaded.languages) !== stableRecord(current.languages)) {
    warnings.push("detected language distribution changed");
  }
  if (areaSignature(loaded) !== areaSignature(current)) {
    warnings.push("project areas changed");
  }
  if (featureSignatureForMap(loaded) !== featureSignatureForMap(current)) {
    warnings.push("semantic feature map changed");
  }
  if (workspaceSignatureForMap(loaded) !== workspaceSignatureForMap(current)) {
    warnings.push("workspace map changed");
  }
  return {
    stale: warnings.length > 0,
    warnings,
    current
  };
}

export function createParallelExecutionMeta(
  map: ProjectMap,
  mapPath: string,
  mode: ParallelMode
): ParallelExecutionMeta {
  const requested = resolveParallelism(mode, map.recommendedParallelism);
  const shards = createWorkShards(map.areas, requested, {
    workspaces: map.workspaces ?? [],
    changedFiles: map.since?.changedFiles ?? []
  });
  const effectiveParallelism = Math.max(1, Math.min(requested, shards.length));
  return {
    mode,
    projectMapPath: mapPath,
    initialized: true,
    recommendedParallelism: map.recommendedParallelism,
    effectiveParallelism,
    shards,
    warnings: effectiveParallelism < requested
      ? [`Requested ${requested} provider sessions, but only ${effectiveParallelism} useful shard(s) were found.`]
      : []
  };
}

export function renderProjectPlan(map: ProjectMap, mode: ParallelMode = "auto"): string {
  const meta = createParallelExecutionMeta(map, projectMapPath(map.projectRoot, map.outDir), mode);
  const languageLines = Object.entries(map.languages)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([language, count]) => `- ${language}: ${count}`)
    .join("\n") || "- Not detected";
  const areaLines = map.areas
    .slice(0, 12)
    .map((area) => `- ${area.title}: ${area.fileCount} files, paths: ${area.paths.join(", ")}`)
    .join("\n") || "- No areas detected";
  const featureLines = (map.features ?? [])
    .slice(0, 12)
    .map((feature) => `- ${feature.title}: ${feature.kind}, paths: ${feature.paths.join(", ") || "n/a"}`)
    .join("\n") || "- No semantic features detected";
  const shardLines = meta.shards
    .map((shard) => [
      `- ${shard.id}: ${shard.title}${shard.workspace ? ` (${shard.workspace})` : ""}`,
      `  paths: ${shard.paths.join(", ") || "n/a"}`,
      `  focus: ${shard.focus}`,
      shard.validationCommands?.length ? `  validation: ${shard.validationCommands.join(", ")}` : undefined
    ].filter(Boolean).join("\n"))
    .join("\n");
  const workspaceLines = (map.workspaces ?? [])
    .slice(0, 12)
    .map((workspace) => `- ${workspace.name}: ${workspace.path}, scripts: ${Object.keys(workspace.scripts ?? {}).join(", ") || "none"}, deps: ${(workspace.dependencies ?? []).slice(0, 8).join(", ") || "none"}`)
    .join("\n") || "- No package workspaces detected";

  return `RepoVista Project Plan

Project root: ${map.projectRoot}
Project map: ${projectMapPath(map.projectRoot, map.outDir)}
Files: ${map.fileCount}
Recommended provider sessions: ${map.recommendedParallelism}
Planned provider sessions: ${meta.effectiveParallelism}

Languages:
${languageLines}

Workspaces:
${workspaceLines}

Areas:
${areaLines}

Semantic features:
${featureLines}

Provider-session assignments:
${shardLines}
`;
}

export function projectMapPath(projectRoot: string, outDir: string): string {
  return path.resolve(projectRoot, outDir, "project-map.json");
}

async function writeProjectMap(mapPath: string, map: ProjectMap): Promise<void> {
  await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

async function readPackageJson(projectRoot: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
function countLanguages(files: ProjectFileSummary[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const file of files) {
    result[file.language] = (result[file.language] ?? 0) + 1;
  }
  return result;
}

function detectPackageManagers(files: ProjectFileSummary[]): string[] {
  const names = new Set(files.map((file) => path.basename(file.relativePath)));
  const managers: string[] = [];
  if (names.has("package-lock.json")) {
    managers.push("npm");
  }
  if (names.has("pnpm-lock.yaml")) {
    managers.push("pnpm");
  }
  if (names.has("yarn.lock")) {
    managers.push("Yarn");
  }
  if (names.has("bun.lockb")) {
    managers.push("Bun");
  }
  if (names.has("Cargo.lock") || names.has("Cargo.toml")) {
    managers.push("Cargo");
  }
  return managers;
}

function detectFrameworks(packageJson: Record<string, unknown> | undefined): string[] {
  const dependencies = {
    ...readStringRecord(packageJson?.dependencies),
    ...readStringRecord(packageJson?.devDependencies)
  };
  const known = new Map([
    ["@types/node", "Node.js"],
    ["typescript", "TypeScript"],
    ["react", "React"],
    ["vue", "Vue"],
    ["svelte", "Svelte"],
    ["next", "Next.js"],
    ["vite", "Vite"],
    ["vitest", "Vitest"],
    ["jest", "Jest"],
    ["eslint", "ESLint"]
  ]);
  return Object.keys(dependencies)
    .map((name) => known.get(name))
    .filter((value): value is string => Boolean(value))
    .sort();
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      result[key] = item;
    }
  }
  return result;
}

function stableRecord(value: Record<string, number>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function areaSignature(map: ProjectMap): string {
  return JSON.stringify(map.areas.map((area) => ({
    id: area.id,
    paths: area.paths,
    fileCount: area.fileCount,
    bytes: area.bytes
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

function featureSignatureForMap(map: ProjectMap): string {
  return JSON.stringify((map.features ?? []).map((feature) => ({
    title: feature.title,
    kind: feature.kind,
    paths: feature.paths,
    ownedFiles: feature.ownedFiles
  })).sort((left, right) => left.title.localeCompare(right.title)));
}

function workspaceSignatureForMap(map: ProjectMap): string {
  return JSON.stringify((map.workspaces ?? []).map((workspace) => ({
    name: workspace.name,
    path: workspace.path,
    packageManager: workspace.packageManager,
    scripts: Object.keys(workspace.scripts ?? {}).sort(),
    dependencies: [...(workspace.dependencies ?? [])].sort(),
    validationCommands: [...(workspace.validationCommands ?? [])].sort()
  })).sort((left, right) => left.path.localeCompare(right.path)));
}
