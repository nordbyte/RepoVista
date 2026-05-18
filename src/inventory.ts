import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { renderEvidenceMarkdown } from "./evidence.js";
import { createIgnoreMatcher, normalizeRelative } from "./ignore.js";
import { maskObject, maskSensitiveText } from "./secrets.js";
import type { EvidencePack, SandboxMode } from "./types.js";

export interface InventoryOptions {
  outDir: string;
  includes: string[];
  ignores: string[];
  codex?: {
    model?: string;
    profile?: string;
    reasoning?: string;
    fastMode: boolean;
    sandbox: SandboxMode;
  };
  now?: Date;
  maxFiles?: number;
  maxTreeEntries?: number;
  evidence?: EvidencePack;
}

export interface InventoryResult {
  markdown: string;
  fileCount: number;
  omittedFileCount: number;
  warnings: string[];
  languages: Record<string, number>;
  frameworks: string[];
  packageManagers: string[];
}

interface ScannedFile {
  relativePath: string;
  extension: string;
  size: number;
}

interface ScanState {
  files: ScannedFile[];
  directories: Set<string>;
  omittedFileCount: number;
  truncated: boolean;
}

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_TREE_ENTRIES = 300;

const CONFIG_FILE_NAMES = new Set([
  ".editorconfig",
  ".eslintignore",
  ".eslintrc",
  ".eslintrc.cjs",
  ".eslintrc.js",
  ".eslintrc.json",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
  ".prettierrc.json",
  "Dockerfile",
  "Makefile",
  "biome.json",
  "compose.yaml",
  "docker-compose.yml",
  "eslint.config.js",
  "eslint.config.mjs",
  "jest.config.js",
  "next.config.js",
  "package.json",
  "playwright.config.ts",
  "postcss.config.js",
  "prettier.config.js",
  "rollup.config.js",
  "tailwind.config.js",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.ts",
  "vitest.config.ts"
]);

const LOCKFILES = new Map([
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "Yarn"],
  ["bun.lockb", "Bun"],
  ["Cargo.lock", "Cargo"],
  ["go.sum", "Go modules"],
  ["poetry.lock", "Poetry"],
  ["Pipfile.lock", "Pipenv"],
  ["composer.lock", "Composer"],
  ["Gemfile.lock", "Bundler"]
]);

const LANGUAGE_BY_EXTENSION = new Map([
  [".c", "C"],
  [".cc", "C++"],
  [".cpp", "C++"],
  [".cs", "C#"],
  [".css", "CSS"],
  [".go", "Go"],
  [".html", "HTML"],
  [".java", "Java"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript React"],
  [".kt", "Kotlin"],
  [".mjs", "JavaScript"],
  [".php", "PHP"],
  [".py", "Python"],
  [".rb", "Ruby"],
  [".rs", "Rust"],
  [".scss", "SCSS"],
  [".sh", "Shell"],
  [".swift", "Swift"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript React"],
  [".vue", "Vue"],
  [".yml", "YAML"],
  [".yaml", "YAML"]
]);

const FRAMEWORK_DEPENDENCIES = new Map([
  ["@angular/core", "Angular"],
  ["@nestjs/core", "NestJS"],
  ["@sveltejs/kit", "SvelteKit"],
  ["astro", "Astro"],
  ["cypress", "Cypress"],
  ["electron", "Electron"],
  ["eslint", "ESLint"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["jest", "Jest"],
  ["next", "Next.js"],
  ["playwright", "Playwright"],
  ["prettier", "Prettier"],
  ["react", "React"],
  ["remix", "Remix"],
  ["rollup", "Rollup"],
  ["tailwindcss", "Tailwind CSS"],
  ["tsup", "tsup"],
  ["typescript", "TypeScript"],
  ["vite", "Vite"],
  ["vitest", "Vitest"],
  ["vue", "Vue"],
  ["webpack", "Webpack"]
]);

export async function createProjectInventory(
  projectRoot: string,
  options: InventoryOptions
): Promise<InventoryResult> {
  const now = options.now ?? new Date();
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTreeEntries = options.maxTreeEntries ?? DEFAULT_MAX_TREE_ENTRIES;
  const matcher = createIgnoreMatcher({
    projectRoot,
    outDir: options.outDir,
    includePatterns: options.includes,
    ignorePatterns: options.ignores
  });

  const state: ScanState = {
    files: [],
    directories: new Set(),
    omittedFileCount: 0,
    truncated: false
  };

  await walkProject(projectRoot, "", matcher.shouldIgnore, state, maxFiles);

  const packageJson = await readPackageJson(projectRoot);
  const packageManagers = detectPackageManagers(state.files, packageJson.exists);
  const languages = detectLanguages(state.files);
  const frameworks = detectFrameworks(packageJson.data);
  const configFiles = state.files
    .map((file) => file.relativePath)
    .filter((relativePath) => CONFIG_FILE_NAMES.has(path.basename(relativePath)))
    .sort();
  const lockfiles = state.files
    .map((file) => file.relativePath)
    .filter((relativePath) => LOCKFILES.has(path.basename(relativePath)))
    .sort();
  const importantDirectories = Array.from(state.directories)
    .filter((directory) => !directory.includes("/"))
    .sort()
    .slice(0, 40);

  const warnings: string[] = [];
  if (state.truncated) {
    warnings.push(`Inventory shortened: more than ${maxFiles} relevant files found.`);
  }
  if (state.files.length > 3000) {
    warnings.push("The repository is large. RepoVista shortens the file tree and passes only compact context to Codex.");
  }

  const markdown = renderInventory({
    projectRoot,
    now,
    files: state.files,
    omittedFileCount: state.omittedFileCount,
    warnings,
    packageJson,
    packageManagers,
    lockfiles,
    languages,
    frameworks,
    configFiles,
    importantDirectories,
    includes: options.includes,
    ignores: options.ignores,
    codex: options.codex,
    evidence: options.evidence,
    maxTreeEntries
  });

  return {
    markdown,
    fileCount: state.files.length,
    omittedFileCount: state.omittedFileCount,
    warnings,
    languages,
    frameworks,
    packageManagers
  };
}

async function walkProject(
  root: string,
  relativeDirectory: string,
  shouldIgnore: (relativePath: string, isDirectory: boolean) => boolean,
  state: ScanState,
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

    state.files.push({
      relativePath,
      extension: path.extname(relativePath).toLowerCase(),
      size: stats.size
    });
  }
}

async function readPackageJson(projectRoot: string): Promise<{ exists: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
    return {
      exists: true,
      data: maskObject(JSON.parse(raw)) as Record<string, unknown>
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return { exists: false };
    }
    return {
      exists: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function detectPackageManagers(files: ScannedFile[], hasPackageJson: boolean): string[] {
  const managers = new Set<string>();
  if (hasPackageJson) {
    managers.add("npm-compatible package.json");
  }
  for (const file of files) {
    const manager = LOCKFILES.get(path.basename(file.relativePath));
    if (manager) {
      managers.add(manager);
    }
  }
  return Array.from(managers).sort();
}

function detectLanguages(files: ScannedFile[]): Record<string, number> {
  const languages: Record<string, number> = {};
  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION.get(file.extension);
    if (!language) {
      continue;
    }
    languages[language] = (languages[language] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(languages).sort((left, right) => right[1] - left[1]));
}

function detectFrameworks(packageJson?: Record<string, unknown>): string[] {
  if (!packageJson) {
    return [];
  }

  const allDependencies = {
    ...readObject(packageJson.dependencies),
    ...readObject(packageJson.devDependencies),
    ...readObject(packageJson.peerDependencies),
    ...readObject(packageJson.optionalDependencies)
  };

  const frameworks = new Set<string>();
  for (const dependency of Object.keys(allDependencies)) {
    const framework = FRAMEWORK_DEPENDENCIES.get(dependency);
    if (framework) {
      frameworks.add(framework);
    }
  }
  return Array.from(frameworks).sort();
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function renderInventory(input: {
  projectRoot: string;
  now: Date;
  files: ScannedFile[];
  omittedFileCount: number;
  warnings: string[];
  packageJson: { exists: boolean; data?: Record<string, unknown>; error?: string };
  packageManagers: string[];
  lockfiles: string[];
  languages: Record<string, number>;
  frameworks: string[];
  configFiles: string[];
  importantDirectories: string[];
  includes: string[];
  ignores: string[];
  codex?: {
    model?: string;
    profile?: string;
    reasoning?: string;
    fastMode: boolean;
    sandbox: SandboxMode;
  };
  evidence?: EvidencePack;
  maxTreeEntries: number;
}): string {
  const packageScripts = readPackageScripts(input.packageJson.data);
  const hints = detectProjectHints(input.files, packageScripts);

  return `# RepoVista Project Inventory

## Run

- Project root: \`${input.projectRoot}\`
- Timestamp: ${input.now.toISOString()}
- Relevant files in inventory: ${input.files.length}
- Omitted files: ${input.omittedFileCount}
- Note: Sensitive file contents are not collected; detected sensitive values are masked.

${renderWarnings(input.warnings)}
${input.evidence ? renderEvidenceMarkdown(input.evidence) : ""}

## Package Managers and Lockfiles

${renderList(input.packageManagers.length ? input.packageManagers : ["Not clearly detected"])}

Lockfiles:

${renderList(input.lockfiles.length ? input.lockfiles : ["No relevant lockfiles detected"])}

## Detected Frameworks and Build Tools

${renderList(input.frameworks.length ? input.frameworks : ["Not clearly inferable from package.json"])}

## Programming Languages by File Extension

${renderKeyValueTable(input.languages, "Language", "Files")}

## Relevant package.json Scripts

${renderKeyValueTable(packageScripts, "Script", "Command")}

## Test, Build, and Lint Signals

${renderList(hints.length ? hints : ["No clear signals detected"])}

## Important Configuration Files

${renderList(input.configFiles.length ? input.configFiles : ["No known configuration files detected"])}

## Important Directories

${renderList(input.importantDirectories.length ? input.importantDirectories : ["No relevant top-level directories detected"])}

## Documentation, APIs, Tests, Migrations, and Deployment

${renderList(detectSpecialFiles(input.files))}

## Additional Include/Ignore Patterns

- Include: ${input.includes.length ? input.includes.map((item) => `\`${item}\``).join(", ") : "none"}
- Ignore: ${input.ignores.length ? input.ignores.map((item) => `\`${item}\``).join(", ") : "none"}

## Codex Execution Settings

${renderCodexSettings(input.codex)}

## Shortened File Tree

\`\`\`text
${renderTree(input.files, input.maxTreeEntries)}
\`\`\`
`;
}

function renderCodexSettings(codex: {
  model?: string;
  profile?: string;
  reasoning?: string;
  fastMode: boolean;
  sandbox: SandboxMode;
} | undefined): string {
  return [
    `- Model: ${codex?.model ?? "Codex configured default"}`,
    `- Reasoning: ${codex?.reasoning ?? "model default"}`,
    `- Fast mode: ${codex?.fastMode ? "on" : "off"}`,
    `- Profile: ${codex?.profile ?? "none"}`,
    `- Sandbox: ${codex?.sandbox ?? "read-only"}`,
    "- Approval policy: never"
  ].join("\n");
}

function readPackageScripts(packageJson?: Record<string, unknown>): Record<string, string> {
  const scripts = readObject(packageJson?.scripts);
  const result: Record<string, string> = {};
  for (const [name, command] of Object.entries(scripts).sort(([left], [right]) => left.localeCompare(right))) {
    if (typeof command === "string") {
      result[name] = maskSensitiveText(command);
    }
  }
  return result;
}

function detectProjectHints(files: ScannedFile[], scripts: Record<string, string>): string[] {
  const hints = new Set<string>();
  for (const name of Object.keys(scripts)) {
    if (/test/i.test(name)) {
      hints.add(`Test script: \`npm run ${name}\``);
    }
    if (/build/i.test(name)) {
      hints.add(`Build script: \`npm run ${name}\``);
    }
    if (/lint/i.test(name)) {
      hints.add(`Lint script: \`npm run ${name}\``);
    }
  }

  const paths = files.map((file) => file.relativePath);
  if (paths.some((file) => /^test[s]?\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file))) {
    hints.add("Test files or test directory detected");
  }
  if (paths.some((file) => /^\.github\/workflows\//.test(file))) {
    hints.add("GitHub Actions workflow detected");
  }
  if (paths.some((file) => /Dockerfile$|docker-compose\.ya?ml$/.test(file))) {
    hints.add("Docker/container configuration detected");
  }
  return Array.from(hints).sort();
}

function detectSpecialFiles(files: ScannedFile[]): string[] {
  const paths = files.map((file) => file.relativePath);
  const matches = paths.filter((file) => {
    const lower = file.toLowerCase();
    return (
      lower.includes("readme") ||
      lower.startsWith("docs/") ||
      lower.includes("openapi") ||
      lower.includes("swagger") ||
      lower.includes("api") ||
      lower.includes("test") ||
      lower.includes("spec") ||
      lower.includes("migration") ||
      lower.includes("deploy") ||
      lower.startsWith(".github/workflows/")
    );
  });

  return matches.length ? matches.slice(0, 80) : ["No clear special files detected"];
}

function renderWarnings(warnings: string[]): string {
  if (!warnings.length) {
    return "## Warnings\n\n- None";
  }
  return `## Warnings\n\n${renderList(warnings)}`;
}

function renderList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderKeyValueTable(values: Record<string, string | number>, leftTitle: string, rightTitle: string): string {
  const entries = Object.entries(values);
  if (!entries.length) {
    return `| ${leftTitle} | ${rightTitle} |\n|---|---|\n| No data | - |`;
  }

  return [
    `| ${leftTitle} | ${rightTitle} |`,
    "|---|---|",
    ...entries.map(([key, value]) => `| ${escapeTableCell(key)} | ${escapeTableCell(String(value))} |`)
  ].join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderTree(files: ScannedFile[], maxEntries: number): string {
  const paths = files.map((file) => file.relativePath).sort();
  const visible = paths.slice(0, maxEntries);
  const lines = ["."];
  for (const relativePath of visible) {
    lines.push(`- ${relativePath}`);
  }
  if (paths.length > visible.length) {
    lines.push(`... ${paths.length - visible.length} additional entries omitted`);
  }
  return lines.join("\n");
}
