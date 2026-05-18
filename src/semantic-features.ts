import path from "node:path";
import { stableId } from "./stable-id.js";
import type { DiffScope, ProjectArea, ProjectFileSummary, SemanticFeature } from "./types.js";

const MAX_FILES_PER_FEATURE = 40;

export function buildSemanticFeatures(
  files: ProjectFileSummary[],
  areas: ProjectArea[],
  since?: DiffScope
): SemanticFeature[] {
  const changed = new Set(since?.changedFiles ?? []);
  const areaFeatures = areas.map((area) => featureForArea(area, filesForArea(files, area), changed, Boolean(since)));
  if (!since || changed.size === 0) {
    return areaFeatures;
  }

  const changedFiles = files.filter((file) => changed.has(file.relativePath));
  if (!changedFiles.length) {
    return areaFeatures;
  }

  return [
    {
      id: stableId("feat", ["diff", since.ref, [...changed].sort()]),
      title: `Changed files since ${since.ref}`,
      kind: "diff-scope",
      paths: compactPaths(changedFiles),
      ownedFiles: changedFiles.map((file) => file.relativePath).slice(0, MAX_FILES_PER_FEATURE),
      contextFiles: relatedContextFiles(files, changedFiles),
      tests: testFilesFor(changedFiles),
      tags: ["diff", "changed"],
      trustBoundaries: trustBoundariesFor(changedFiles),
      source: "diff",
      confidence: "high"
    },
    ...areaFeatures
  ];
}

function featureForArea(
  area: ProjectArea,
  files: ProjectFileSummary[],
  changed: Set<string>,
  hasDiffScope: boolean
): SemanticFeature {
  const ownedFiles = files
    .filter((file) => !isTestPath(file.relativePath))
    .map((file) => file.relativePath)
    .slice(0, MAX_FILES_PER_FEATURE);
  const tests = testFilesFor(files);
  const contextFiles = files
    .filter((file) => isContextFile(file.relativePath))
    .map((file) => file.relativePath)
    .slice(0, MAX_FILES_PER_FEATURE);
  const changedOwnedFiles = files.filter((file) => changed.has(file.relativePath));

  return {
    id: stableId("feat", [area.id, area.paths, area.primaryLanguages]),
    title: area.title,
    kind: classifyArea(area, files),
    paths: area.paths,
    ownedFiles,
    contextFiles: relatedContextFiles(files, changedOwnedFiles.length ? changedOwnedFiles : files),
    tests,
    tags: tagsFor(area, files, hasDiffScope && changedOwnedFiles.length > 0),
    trustBoundaries: trustBoundariesFor(files),
    source: "project-map",
    confidence: area.fileCount > 10 ? "high" : "medium"
  };
}

function filesForArea(files: ProjectFileSummary[], area: ProjectArea): ProjectFileSummary[] {
  return files.filter((file) => area.paths.some((areaPath) => file.relativePath === areaPath || file.relativePath.startsWith(`${areaPath.replace(/\/+$/g, "")}/`)));
}

function classifyArea(area: ProjectArea, files: ProjectFileSummary[]): string {
  const paths = `${area.paths.join(" ")} ${files.map((file) => file.relativePath).join(" ")}`.toLowerCase();
  if (/\b(test|tests|spec|fixtures)\b/.test(paths)) {
    return "test-suite";
  }
  if (paths.includes(".github") || paths.includes("workflow")) {
    return "ci";
  }
  if (/\b(doc|docs|readme)\b/.test(paths)) {
    return "documentation";
  }
  if (/\b(provider|adapter|integration)\b/.test(paths)) {
    return "integration";
  }
  if (/\b(cli|command|options|settings)\b/.test(paths)) {
    return "cli";
  }
  if (/\b(report|audit|finding|evidence)\b/.test(paths)) {
    return "reporting";
  }
  if (files.some((file) => file.relativePath === "package.json" || file.relativePath.endsWith("tsconfig.json"))) {
    return "configuration";
  }
  return "application";
}

function compactPaths(files: ProjectFileSummary[]): string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const directory = path.posix.dirname(file.relativePath);
    directories.add(directory === "." ? file.relativePath : directory);
  }
  return Array.from(directories).sort().slice(0, 20);
}

function testFilesFor(files: ProjectFileSummary[]): string[] {
  return files
    .filter((file) => isTestPath(file.relativePath))
    .map((file) => file.relativePath)
    .slice(0, MAX_FILES_PER_FEATURE);
}

function relatedContextFiles(allFiles: ProjectFileSummary[], seedFiles: ProjectFileSummary[]): string[] {
  const directories = new Set(seedFiles.map((file) => path.posix.dirname(file.relativePath)));
  return allFiles
    .filter((file) => isContextFile(file.relativePath) || directories.has(path.posix.dirname(file.relativePath)))
    .map((file) => file.relativePath)
    .slice(0, MAX_FILES_PER_FEATURE);
}

function tagsFor(area: ProjectArea, files: ProjectFileSummary[], changed: boolean): string[] {
  const tags = new Set<string>([classifyArea(area, files)]);
  if (changed) {
    tags.add("changed");
  }
  for (const language of area.primaryLanguages.slice(0, 3)) {
    tags.add(language.toLowerCase());
  }
  return Array.from(tags).sort();
}

function trustBoundariesFor(files: ProjectFileSummary[]): string[] {
  const boundaries = new Set<string>();
  const joined = files.map((file) => file.relativePath).join(" ").toLowerCase();
  if (/provider|adapter|api|client|server|http|webhook/.test(joined)) {
    boundaries.add("external-service");
  }
  if (/auth|token|secret|credential|key/.test(joined)) {
    boundaries.add("secret-handling");
  }
  if (/file|path|fs|upload|download|report/.test(joined)) {
    boundaries.add("filesystem");
  }
  if (/workflow|github|publish|npm|release/.test(joined)) {
    boundaries.add("release-automation");
  }
  return Array.from(boundaries).sort();
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(test|tests|__tests__|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function isContextFile(filePath: string): boolean {
  return /(^|\/)(package\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod|\.github\/.+\.ya?ml)$/.test(filePath);
}
