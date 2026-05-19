import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderEvidenceMarkdown } from "./evidence.js";
import { scanProject, type ProjectScanResult } from "./project-scan.js";
import { maskObject, maskSensitiveText } from "./secrets.js";
import type { AiProviderId, EvidencePack, ProjectFileSummary, SandboxMode } from "./types.js";

export interface InventoryOptions {
  outDir: string;
  includes: string[];
  ignores: string[];
  ai?: {
    provider: AiProviderId;
    displayName: string;
    executable: string;
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
  scan?: ProjectScanResult;
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
  const scan = options.scan ?? await scanProject(projectRoot, {
    outDir: options.outDir,
    includes: options.includes,
    ignores: options.ignores,
    maxFiles
  });
  const files = scan.files.slice(0, maxFiles);
  const omittedFileCount = scan.omittedFileCount + Math.max(0, scan.files.length - files.length);
  const truncated = scan.truncated || scan.files.length > files.length;
  const packageJson = await readPackageJson(projectRoot);
  const packageManagers = detectPackageManagers(files, packageJson.exists);
  const languages = detectLanguages(files);
  const frameworks = detectFrameworks(packageJson.data);
  const configFiles = files
    .map((file) => file.relativePath)
    .filter((relativePath) => CONFIG_FILE_NAMES.has(path.basename(relativePath)))
    .sort();
  const lockfiles = files
    .map((file) => file.relativePath)
    .filter((relativePath) => LOCKFILES.has(path.basename(relativePath)))
    .sort();
  const importantDirectories = scan.directories
    .filter((directory) => !directory.includes("/"))
    .sort()
    .slice(0, 40);

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(`Inventory shortened: more than ${maxFiles} relevant files found.`);
  }
  if (files.length > 3000) {
    warnings.push("The repository is large. RepoVista shortens the file tree and passes only compact context to the selected provider.");
  }

  const markdown = renderInventory({
    projectRoot,
    now,
    files,
    omittedFileCount,
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
    ai: options.ai,
    evidence: options.evidence,
    maxTreeEntries
  });

  return {
    markdown,
    fileCount: files.length,
    omittedFileCount,
    warnings,
    languages,
    frameworks,
    packageManagers
  };
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

function detectPackageManagers(files: ProjectFileSummary[], hasPackageJson: boolean): string[] {
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

function detectLanguages(files: ProjectFileSummary[]): Record<string, number> {
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
  files: ProjectFileSummary[];
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
  ai?: {
    provider: AiProviderId;
    displayName: string;
    executable: string;
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

## AI Provider Execution Settings

${renderAiSettings(input.ai)}

## Shortened File Tree

\`\`\`text
${renderTree(input.files, input.maxTreeEntries)}
\`\`\`
`;
}

function renderAiSettings(ai: {
  provider: AiProviderId;
  displayName: string;
  executable: string;
  model?: string;
  profile?: string;
  reasoning?: string;
  fastMode: boolean;
  sandbox: SandboxMode;
} | undefined): string {
  const permissionLine = ai?.provider === "claude"
    ? `- Claude permission mode: ${ai.sandbox === "read-only" ? "plan" : "default"}`
    : ai?.provider === "codex" || !ai
      ? "- Codex approval policy: never"
      : `- Provider sandbox intent: ${ai.sandbox}`;
  return [
    `- Provider: ${ai?.displayName ?? "Codex CLI"}`,
    `- Executable: ${ai?.executable ?? "codex"}`,
    `- Model: ${ai?.model ?? "not supplied"}`,
    `- Reasoning: ${ai?.reasoning ?? "xhigh"}`,
    `- Fast mode: ${ai?.fastMode ? "on" : "off"}`,
    `- Provider profile: ${ai?.profile ?? "none"}`,
    `- Sandbox: ${ai?.sandbox ?? "read-only"}`,
    permissionLine
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

function detectProjectHints(files: ProjectFileSummary[], scripts: Record<string, string>): string[] {
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

function detectSpecialFiles(files: ProjectFileSummary[]): string[] {
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

function renderTree(files: ProjectFileSummary[], maxEntries: number): string {
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
