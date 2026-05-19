import path from "node:path";
import { stableId } from "./stable-id.js";
import type { DiffScope, ProjectArea, ProjectFileSummary, SemanticFeature } from "./types.js";

const MAX_FILES_PER_FEATURE = 40;

export function buildSemanticFeatures(
  files: ProjectFileSummary[],
  areas: ProjectArea[],
  since?: DiffScope,
  packageJson?: Record<string, unknown>
): SemanticFeature[] {
  const changed = new Set(since?.changedFiles ?? []);
  const areaFeatures = areas.map((area) => featureForArea(area, filesForArea(files, area), changed, Boolean(since)));
  const baseFeatures = dedupeFeatures([
    ...packageScriptFeatures(files, packageJson),
    ...rootConfigFeatures(files),
    ...functionalGroupFeatures(files),
    ...sourceDomainFeatures(files),
    ...testDomainFeatures(files),
    ...ciFeatures(files),
    ...areaFeatures
  ]);

  if (!since || changed.size === 0) {
    return baseFeatures;
  }

  const changedFiles = files.filter((file) => changed.has(file.relativePath));
  if (!changedFiles.length) {
    return baseFeatures;
  }

  return dedupeFeatures([
    {
      id: stableId("feat", ["diff", since.ref, [...changed].sort()]),
      title: `Changed files since ${since.ref}`,
      kind: "diff-scope",
      paths: compactPaths(changedFiles),
      ownedFiles: changedFiles.map((file) => file.relativePath).slice(0, MAX_FILES_PER_FEATURE),
      contextFiles: relatedContextFiles(files, changedFiles),
      tests: testFilesFor(changedFiles),
      entrypoints: [],
      validationCommands: validationCommandsForFeature(files, testFilesFor(changedFiles)),
      tags: ["diff", "changed"],
      trustBoundaries: trustBoundariesFor(changedFiles),
      source: "diff",
      confidence: "high"
    },
    ...baseFeatures
  ]);
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
  const changedOwnedFiles = files.filter((file) => changed.has(file.relativePath));

  return {
    id: stableId("feat", [area.id, area.paths, area.primaryLanguages]),
    title: area.title,
    kind: classifyArea(area, files),
    paths: area.paths,
    ownedFiles,
    contextFiles: relatedContextFiles(files, changedOwnedFiles.length ? changedOwnedFiles : files),
    tests,
    entrypoints: entrypointsForDomain(area.id, ownedFiles),
    validationCommands: validationCommandsForFeature(files, tests),
    tags: tagsFor(area, files, hasDiffScope && changedOwnedFiles.length > 0),
    trustBoundaries: trustBoundariesFor(files),
    source: "project-map",
    confidence: area.fileCount > 10 ? "high" : "medium"
  };
}

function packageScriptFeatures(files: ProjectFileSummary[], packageJson: Record<string, unknown> | undefined): SemanticFeature[] {
  const scripts = readStringRecord(packageJson?.scripts);
  const packageFile = files.find((file) => file.relativePath === "package.json");
  if (!packageFile || !Object.keys(scripts).length) {
    return [];
  }
  return Object.entries(scripts)
    .filter(([name]) => /^(build|test|lint|typecheck|check|ci|release|publish|start|dev|security:audit)$/.test(name))
    .map(([name, command]) => ({
      id: stableId("feat", ["package-script", name, command]),
      title: `Package script ${name}`,
      kind: "package-script",
      paths: ["package.json"],
      ownedFiles: ["package.json"],
      contextFiles: contextFilesFor(files, ["package.json", "package-lock.json", "tsconfig.json"]),
      tests: testFilesFor(files),
      entrypoints: [`npm run ${name}`],
      validationCommands: [`npm run ${name}`],
      tags: ["node", "script", name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()],
      trustBoundaries: trustBoundariesFor([packageFile]),
      source: "mapper" as const,
      confidence: "high" as const
    }));
}

function rootConfigFeatures(files: ProjectFileSummary[]): SemanticFeature[] {
  const configFiles = files.filter((file) => isRootConfigFile(file.relativePath));
  if (!configFiles.length) {
    return [];
  }
  const owned = configFiles.map((file) => file.relativePath).sort();
  return [{
    id: stableId("feat", ["root-config", owned]),
    title: "Project configuration",
    kind: "configuration",
    paths: owned,
    ownedFiles: owned,
    contextFiles: contextFilesFor(files, owned),
    tests: [],
    entrypoints: [],
    validationCommands: validationCommandsFromFiles(owned),
    tags: ["configuration"],
    trustBoundaries: trustBoundariesFor(configFiles),
    source: "mapper",
    confidence: "high"
  }];
}

function functionalGroupFeatures(files: ProjectFileSummary[]): SemanticFeature[] {
  const groups = [
    functionalGroup("cli", "CLI and command surface", ["cli", "options", "command"], "cli"),
    functionalGroup("providers", "AI provider adapters", ["provider", "providers", "codex-runner", "provider-runner", "model"], "provider"),
    functionalGroup("reports", "Reports, findings, and evidence", ["report", "audit", "finding", "evidence", "compare", "export", "quality", "phase", "prompt", "inventory"], "reporting"),
    functionalGroup("state", "Persistent state", ["state", "store", "cache", "baseline", "feature-state", "finding-store", "resume"], "state"),
    functionalGroup("ci", "CI and release automation", ["ci-", "github", "workflow", "release"], "ci"),
    functionalGroup("settings", "Settings", ["settings", "config", "profile"], "settings"),
    functionalGroup("security", "Security and trust boundaries", ["security", "secret", "token", "credential", "preflight", "validation", "sandbox", "trust"], "security")
  ];

  return groups
    .map((group) => featureForFunctionalGroup(files, group))
    .filter((feature): feature is SemanticFeature => Boolean(feature));
}

function functionalGroup(
  id: string,
  title: string,
  matchers: string[],
  kind: string
): { id: string; title: string; matchers: string[]; kind: string } {
  return { id, title, matchers, kind };
}

function featureForFunctionalGroup(
  files: ProjectFileSummary[],
  group: { id: string; title: string; matchers: string[]; kind: string }
): SemanticFeature | undefined {
  const matched = files.filter((file) => {
    const lower = file.relativePath.toLowerCase();
    return group.matchers.some((matcher) => lower.includes(matcher));
  });
  if (!matched.length) {
    return undefined;
  }
  const owned = matched
    .filter((file) => !isTestPath(file.relativePath))
    .map((file) => file.relativePath)
    .sort()
    .slice(0, MAX_FILES_PER_FEATURE);
  const tests = nearbyTests(files, owned);
  return {
    id: stableId("feat", ["functional-group", group.id, owned]),
    title: group.title,
    kind: group.kind,
    paths: compactPaths(matched),
    ownedFiles: owned,
    contextFiles: contextFilesFor(files, owned),
    tests,
    entrypoints: entrypointsForDomain(group.id, owned),
    validationCommands: validationCommandsForFeature(files, tests),
    tags: [group.kind, group.id].sort(),
    trustBoundaries: trustBoundariesFor(matched),
    source: "mapper",
    confidence: matched.length >= 2 ? "high" : "medium"
  };
}

function sourceDomainFeatures(files: ProjectFileSummary[]): SemanticFeature[] {
  const sourceFiles = files.filter((file) => isSourceFile(file.relativePath) && !isTestPath(file.relativePath));
  if (!sourceFiles.length) {
    return [];
  }
  const buckets = new Map<string, ProjectFileSummary[]>();
  for (const file of sourceFiles) {
    const domain = sourceDomain(file.relativePath);
    const bucket = buckets.get(domain) ?? [];
    bucket.push(file);
    buckets.set(domain, bucket);
  }
  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, domainFiles]) => {
      const owned = domainFiles.map((file) => file.relativePath).sort();
      const tests = nearbyTests(files, owned);
      const kind = kindForDomain(domain, owned);
      return {
        id: stableId("feat", ["source-domain", domain, owned]),
        title: domain === "src" ? "Source root" : `Source ${domain}`,
        kind,
        paths: compactPaths(domainFiles),
        ownedFiles: owned.slice(0, MAX_FILES_PER_FEATURE),
        contextFiles: contextFilesFor(files, owned),
        tests,
        entrypoints: entrypointsForDomain(domain, owned),
        validationCommands: validationCommandsForFeature(files, tests),
        tags: Array.from(new Set(["source", kind, ...domain.split(/[/:]/).filter(Boolean)])).sort(),
        trustBoundaries: trustBoundariesFor(domainFiles),
        source: "mapper" as const,
        confidence: domainFiles.length >= 2 ? "high" as const : "medium" as const
      };
    });
}

function testDomainFeatures(files: ProjectFileSummary[]): SemanticFeature[] {
  const testFiles = files.filter((file) => isTestPath(file.relativePath));
  if (!testFiles.length) {
    return [];
  }
  const owned = testFiles.map((file) => file.relativePath).sort();
  return [{
    id: stableId("feat", ["tests", owned]),
    title: "Automated tests",
    kind: "test-suite",
    paths: compactPaths(testFiles),
    ownedFiles: owned.slice(0, MAX_FILES_PER_FEATURE),
    contextFiles: contextFilesFor(files, owned),
    tests: owned.slice(0, MAX_FILES_PER_FEATURE),
    entrypoints: [],
    validationCommands: validationCommandsForFeature(files, owned),
    tags: ["tests"],
    trustBoundaries: [],
    source: "mapper",
    confidence: "high"
  }];
}

function ciFeatures(files: ProjectFileSummary[]): SemanticFeature[] {
  const ciFiles = files.filter((file) => file.relativePath.startsWith(".github/"));
  if (!ciFiles.length) {
    return [];
  }
  const owned = ciFiles.map((file) => file.relativePath).sort();
  return [{
    id: stableId("feat", ["ci", owned]),
    title: "GitHub automation",
    kind: "ci",
    paths: compactPaths(ciFiles),
    ownedFiles: owned.slice(0, MAX_FILES_PER_FEATURE),
    contextFiles: contextFilesFor(files, ["package.json", "package-lock.json"]),
    tests: [],
    entrypoints: owned,
    validationCommands: [],
    tags: ["ci", "github"],
    trustBoundaries: ["release-automation"],
    source: "mapper",
    confidence: "high"
  }];
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

function nearbyTests(files: ProjectFileSummary[], ownedFiles: string[]): string[] {
  const ownedNames = new Set(ownedFiles.map((file) => path.posix.basename(file).replace(/\.[^.]+$/, "")));
  const ownedDirs = new Set(ownedFiles.map((file) => path.posix.dirname(file)));
  return files
    .filter((file) => isTestPath(file.relativePath))
    .filter((file) => ownedDirs.has(path.posix.dirname(file.relativePath)) || ownedNames.has(path.posix.basename(file.relativePath).replace(/\.(test|spec)?\.?[cm]?[jt]sx?$/, "")))
    .map((file) => file.relativePath)
    .slice(0, MAX_FILES_PER_FEATURE);
}

function relatedContextFiles(allFiles: ProjectFileSummary[], seedFiles: ProjectFileSummary[]): string[] {
  return contextFilesFor(allFiles, seedFiles.map((file) => file.relativePath));
}

function contextFilesFor(allFiles: ProjectFileSummary[], seedPaths: string[]): string[] {
  const wanted = new Set(seedPaths);
  const directories = new Set(seedPaths.map((file) => path.posix.dirname(file)));
  return allFiles
    .filter((file) => isContextFile(file.relativePath) || wanted.has(file.relativePath) || directories.has(path.posix.dirname(file.relativePath)))
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

function sourceDomain(filePath: string): string {
  const parts = filePath.split("/");
  if (parts[0] !== "src") {
    return parts[0] ?? filePath;
  }
  const functional = functionalSourceDomain(filePath);
  if (functional) {
    return functional;
  }
  if (parts.length > 2) {
    return `src/${parts[1]}`;
  }
  const basename = path.posix.basename(filePath).toLowerCase();
  if (/cli|option|command/.test(basename)) {
    return "src/:cli";
  }
  if (/provider|adapter|plugin|model/.test(basename)) {
    return "src/:provider";
  }
  if (/config|setting|profile/.test(basename)) {
    return "src/:config";
  }
  if (/finding|report|audit|evidence|compare|export/.test(basename)) {
    return "src/:reporting";
  }
  if (/state|store|cache|resume/.test(basename)) {
    return "src/:store";
  }
  return "src";
}

function kindForDomain(domain: string, files: string[]): string {
  const joined = `${domain} ${files.join(" ")}`.toLowerCase();
  if (/cli|option|command/.test(joined)) {
    return "cli";
  }
  if (/provider|adapter|plugin/.test(joined)) {
    return "provider";
  }
  if (/config|setting|profile/.test(joined)) {
    return "settings";
  }
  if (/finding|report|audit|evidence|compare|export/.test(joined)) {
    return "reporting";
  }
  if (/state|store|cache|resume/.test(joined)) {
    return "state";
  }
  if (/ci|github|workflow|release/.test(joined)) {
    return "ci";
  }
  if (/security|secret|token|credential|preflight|validation|sandbox|trust/.test(joined)) {
    return "security";
  }
  return "application";
}

function functionalSourceDomain(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  if (/\/providers?\//.test(lower) || /(^|\/)(provider|providers|codex-runner|provider-runner|provider-models|provider-schema)\./.test(lower)) {
    return "src/:providers";
  }
  if (/(^|\/)(cli|cli-schema|options|.*-commands?)\./.test(lower)) {
    return "src/:cli";
  }
  if (/settings/.test(lower)) {
    return "src/:settings";
  }
  if (/(report|audit|finding|evidence|compare|export|quality|phase|prompt|inventory|roadmap)/.test(lower)) {
    return "src/:reports";
  }
  if (/(state|store|cache|baseline|feature-state|finding-store|resume)/.test(lower)) {
    return "src/:state";
  }
  if (/(secret|security|token|credential|preflight|validation|sandbox|trust)/.test(lower)) {
    return "src/:security";
  }
  if (/(ci-|github|workflow|release)/.test(lower)) {
    return "src/:ci";
  }
  return undefined;
}

function entrypointsForDomain(domain: string, files: string[]): string[] {
  if (/cli|command/.test(domain) || files.some((file) => /(^|\/)cli\.|index\./.test(file))) {
    return files.filter((file) => /cli|index/.test(path.posix.basename(file))).slice(0, 8);
  }
  return [];
}

function validationCommandsForFeature(files: ProjectFileSummary[], tests: string[]): string[] {
  const names = new Set(files.map((file) => file.relativePath));
  const commands: string[] = [];
  if (names.has("package.json")) {
    if (tests.length) {
      commands.push("npm test");
    }
    if (files.some((file) => file.language === "TypeScript")) {
      commands.push("npm run typecheck");
    }
    if (files.some((file) => file.relativePath.includes("src/") || file.relativePath.includes("test/"))) {
      commands.push("npm run lint");
    }
  }
  return commands;
}

function validationCommandsFromFiles(paths: string[]): string[] {
  const commands: string[] = [];
  if (paths.includes("tsconfig.json")) {
    commands.push("npm run typecheck");
  }
  if (paths.includes("package.json")) {
    commands.push("npm test");
  }
  return commands;
}

function isSourceFile(filePath: string): boolean {
  return /^(src|lib|app|packages\/[^/]+\/src|apps\/[^/]+\/src|services\/[^/]+\/src)\//.test(filePath) &&
    /\.(cjs|mjs|js|jsx|ts|tsx|py|rs|go|java|kt|swift|rb|php|cs|cpp|c|h)$/.test(filePath);
}

function isRootConfigFile(filePath: string): boolean {
  return !filePath.includes("/") && /^(package(?:-lock)?\.json|tsconfig.*\.json|jsconfig\.json|Cargo\.toml|Cargo\.lock|pyproject\.toml|go\.mod|go\.sum|README\.md|LICENSE|\.npmrc|\.eslintrc.*|eslint\.config\.)/.test(filePath);
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(test|tests|__tests__|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function isContextFile(filePath: string): boolean {
  return /(^|\/)(package\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod|\.github\/.+\.ya?ml)$/.test(filePath);
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

function dedupeFeatures(features: SemanticFeature[]): SemanticFeature[] {
  const seen = new Set<string>();
  const seenTitleKind = new Set<string>();
  const seenTitle = new Set<string>();
  const output: SemanticFeature[] = [];
  for (const feature of features) {
    const key = `${feature.kind}:${feature.paths.join(",")}:${feature.ownedFiles.join(",")}:${feature.title}`;
    const titleKindKey = `${feature.kind}:${feature.title}`;
    if (seen.has(key) || seenTitleKind.has(titleKindKey) || seenTitle.has(feature.title)) {
      continue;
    }
    seen.add(key);
    seenTitleKind.add(titleKindKey);
    seenTitle.add(feature.title);
    output.push(feature);
  }
  return output.sort((left, right) =>
    featurePriority(left) - featurePriority(right) ||
    right.ownedFiles.length - left.ownedFiles.length ||
    left.title.localeCompare(right.title)
  );
}

function featurePriority(feature: SemanticFeature): number {
  if (feature.source === "diff") {
    return 0;
  }
  if (feature.source === "mapper" && feature.kind !== "package-script") {
    return 1;
  }
  if (feature.kind === "package-script") {
    return 2;
  }
  return 3;
}
