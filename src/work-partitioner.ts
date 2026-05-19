import path from "node:path";
import type { ParallelMode, ProjectArea, ProjectFileSummary, WorkShard } from "./types.js";

const MAX_RECOMMENDED_PARALLELISM = 5;
const ROOT_CONFIG_ID = "root-config";

export function buildProjectAreas(files: ProjectFileSummary[]): ProjectArea[] {
  const buckets = new Map<string, ProjectFileSummary[]>();
  for (const file of files) {
    const areaId = areaIdForPath(file.relativePath);
    const bucket = buckets.get(areaId) ?? [];
    bucket.push(file);
    buckets.set(areaId, bucket);
  }

  return Array.from(buckets.entries())
    .map(([id, areaFiles]) => {
      const paths = Array.from(new Set(areaFiles.map((file) => pathForArea(id, file.relativePath)))).sort();
      const languages = topLanguages(areaFiles);
      return {
        id,
        title: titleForArea(id),
        description: descriptionForArea(id),
        paths,
        primaryLanguages: languages,
        fileCount: areaFiles.length,
        bytes: areaFiles.reduce((sum, file) => sum + file.size, 0)
      };
    })
    .sort((left, right) => {
      const priority = areaPriority(left.id) - areaPriority(right.id);
      return priority || right.fileCount - left.fileCount || left.title.localeCompare(right.title);
    });
}

export function recommendParallelism(fileCount: number, totalBytes: number, areas: ProjectArea[]): number {
  const usefulAreas = areas.filter((area) => area.fileCount >= 3 || area.bytes >= 20_000).length;
  if (fileCount < 250 && totalBytes < 2_000_000) {
    return 1;
  }
  if (fileCount < 1000) {
    return Math.max(1, Math.min(2, usefulAreas || areas.length));
  }
  if (fileCount < 3000) {
    return Math.max(1, Math.min(3, usefulAreas || areas.length));
  }
  if (fileCount < 7000) {
    return Math.max(1, Math.min(4, usefulAreas || areas.length));
  }
  return Math.max(1, Math.min(MAX_RECOMMENDED_PARALLELISM, usefulAreas || areas.length));
}

export function createWorkShards(areas: ProjectArea[], requestedParallelism: number): WorkShard[] {
  const parallelism = Math.max(1, Math.min(MAX_RECOMMENDED_PARALLELISM, Math.floor(requestedParallelism), Math.max(1, areas.length)));
  if (parallelism <= 1 || areas.length <= 1) {
    return [combineAreas("thread-1", "Whole repository", areas)];
  }

  const buckets: ProjectArea[][] = Array.from({ length: parallelism }, () => []);
  const sorted = [...areas].sort((left, right) => right.fileCount - left.fileCount || right.bytes - left.bytes);
  for (const area of sorted) {
    const target = buckets
      .map((bucket, index) => ({ index, files: bucket.reduce((sum, item) => sum + item.fileCount, 0) }))
      .sort((left, right) => left.files - right.files || left.index - right.index)[0];
    buckets[target.index].push(area);
  }

  return buckets
    .filter((bucket) => bucket.length > 0)
    .map((bucket, index) => combineAreas(`thread-${index + 1}`, titleForShard(bucket), bucket));
}

export function resolveParallelism(mode: ParallelMode, recommendedParallelism: number): number {
  if (mode === "off") {
    return 1;
  }
  if (mode === "auto") {
    return recommendedParallelism;
  }
  return Math.max(1, Math.min(MAX_RECOMMENDED_PARALLELISM, Math.floor(mode)));
}

function combineAreas(id: string, title: string, areas: ProjectArea[]): WorkShard {
  const paths = Array.from(new Set(areas.flatMap((area) => area.paths))).sort();
  const languageCounts = new Map<string, number>();
  for (const area of areas) {
    for (const language of area.primaryLanguages) {
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + area.fileCount);
    }
  }
  const focus = areas.map((area) => `${area.title}: ${area.description}`).join(" ");
  return {
    id,
    title,
    description: areas.map((area) => area.title).join(", "),
    paths,
    primaryLanguages: Array.from(languageCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([language]) => language),
    estimatedFiles: areas.reduce((sum, area) => sum + area.fileCount, 0),
    estimatedBytes: areas.reduce((sum, area) => sum + area.bytes, 0),
    focus
  };
}

function areaIdForPath(relativePath: string): string {
  const parts = relativePath.split("/");
  const first = parts[0] ?? ROOT_CONFIG_ID;
  if (parts.length === 1) {
    return ROOT_CONFIG_ID;
  }
  if (first === ".github") {
    return githubAreaId(relativePath);
  }
  if (first === "src") {
    return sourceAreaId(relativePath);
  }
  if ((first === "packages" || first === "apps" || first === "services") && parts.length > 2) {
    return `${first}/${parts[1]}`;
  }
  return first;
}

function pathForArea(id: string, relativePath: string): string {
  if (id !== ROOT_CONFIG_ID && id.includes("/")) {
    return id;
  }
  if (id === ROOT_CONFIG_ID) {
    return relativePath;
  }
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts[0] : relativePath;
}

function titleForArea(id: string): string {
  if (id === ROOT_CONFIG_ID) {
    return "Project configuration";
  }
  if (id === ".github") {
    return "GitHub automation";
  }
  if (id === ".github/security") {
    return "Security automation";
  }
  if (id === ".github/release") {
    return "Release automation";
  }
  if (id === ".github/ci") {
    return "CI automation";
  }
  if (id === "src/cli") {
    return "CLI and commands";
  }
  if (id === "src/providers") {
    return "AI provider adapters";
  }
  if (id === "src/reports") {
    return "Reports and findings";
  }
  if (id === "src/state") {
    return "Persistent state";
  }
  if (id === "src/settings") {
    return "Settings";
  }
  if (id === "src/security") {
    return "Security and validation";
  }
  if (id === "src/ci") {
    return "CI integration";
  }
  if (id === "src/app") {
    return "Application core";
  }
  if (id === "test" || id === "tests") {
    return "Tests";
  }
  if (id === "docs") {
    return "Documentation";
  }
  return id.split("/").map((part) => part.replace(/[-_]/g, " ")).join(" / ");
}

function descriptionForArea(id: string): string {
  if (id === ROOT_CONFIG_ID) {
    return "Root package, build, TypeScript, license, and repository configuration.";
  }
  if (id === ".github") {
    return "CI, security, release, and publish automation.";
  }
  if (id === ".github/security") {
    return "Secret scanning, dependency auditing, and security workflow automation.";
  }
  if (id === ".github/release") {
    return "Release, package publication, and tag automation.";
  }
  if (id === ".github/ci") {
    return "Pull request and push validation workflows.";
  }
  if (id === "test" || id === "tests") {
    return "Automated tests and validation fixtures.";
  }
  if (id === "docs") {
    return "Documentation, images, and user-facing reference material.";
  }
  if (id.startsWith("src/")) {
    return descriptionForSourceArea(id);
  }
  return `Files below ${id}.`;
}

function githubAreaId(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (/security|gitleaks|trufflehog|audit|secret|dependabot/.test(lower)) {
    return ".github/security";
  }
  if (/release|publish|npm|package|tag/.test(lower)) {
    return ".github/release";
  }
  return ".github/ci";
}

function sourceAreaId(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (/\/providers?\//.test(lower) || /(^|\/)(provider|providers|codex-runner|provider-runner|provider-models|provider-schema)\./.test(lower)) {
    return "src/providers";
  }
  if (/(^|\/)(cli|cli-schema|options|.*-commands?)\./.test(lower)) {
    return "src/cli";
  }
  if (/settings/.test(lower)) {
    return "src/settings";
  }
  if (/(report|audit|finding|evidence|compare|export|quality|phase|prompt|inventory|roadmap)/.test(lower)) {
    return "src/reports";
  }
  if (/(state|store|cache|baseline|feature-state|finding-store|resume|migration)/.test(lower)) {
    return "src/state";
  }
  if (/(secret|security|validate|validation|preflight|sandbox|trust)/.test(lower)) {
    return "src/security";
  }
  if (/(ci-|github|workflow|release)/.test(lower)) {
    return "src/ci";
  }
  return "src/app";
}

function descriptionForSourceArea(id: string): string {
  switch (id) {
    case "src/cli":
      return "Command parsing, command dispatch, and user-facing CLI flows.";
    case "src/providers":
      return "Built-in and plugin AI provider adapters, provider execution, models, and schemas.";
    case "src/reports":
      return "Audit prompts, evidence, findings, report extraction, quality gates, exports, and comparison.";
    case "src/state":
      return "Persistent findings, features, baselines, cache, resume, and migration state.";
    case "src/settings":
      return "Interactive and non-interactive persisted settings.";
    case "src/security":
      return "Secret masking, trust checks, preflight validation, and safety boundaries.";
    case "src/ci":
      return "GitHub Actions templates and CI summary integration.";
    case "src/app":
      return "Application orchestration and shared runtime helpers.";
    default:
      return `Application source area ${id}.`;
  }
}

function titleForShard(areas: ProjectArea[]): string {
  if (areas.length === 1) {
    return areas[0].title;
  }
  const important = areas.slice(0, 2).map((area) => area.title).join(" + ");
  return areas.length > 2 ? `${important} + related areas` : important;
}

function topLanguages(files: ProjectFileSummary[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([language]) => language);
}

function areaPriority(id: string): number {
  if (id.startsWith("src")) {
    return 0;
  }
  if (id.startsWith("packages") || id.startsWith("apps") || id.startsWith("services")) {
    return 1;
  }
  if (id === "test" || id === "tests") {
    return 2;
  }
  if (id === ".github") {
    return 3;
  }
  if (id === ROOT_CONFIG_ID) {
    return 4;
  }
  if (id === "docs") {
    return 5;
  }
  return 6;
}

export function languageForPath(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  const basename = path.basename(relativePath).toLowerCase();
  if (basename === "dockerfile") {
    return "Dockerfile";
  }
  switch (extension) {
    case ".ts":
    case ".tsx":
      return "TypeScript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "JavaScript";
    case ".json":
      return "JSON";
    case ".md":
    case ".mdx":
      return "Markdown";
    case ".css":
      return "CSS";
    case ".html":
      return "HTML";
    case ".py":
      return "Python";
    case ".rs":
      return "Rust";
    case ".go":
      return "Go";
    case ".java":
      return "Java";
    case ".yml":
    case ".yaml":
      return "YAML";
    case ".sh":
      return "Shell";
    default:
      return extension ? extension.slice(1).toUpperCase() : "Other";
  }
}
