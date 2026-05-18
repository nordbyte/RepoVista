import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { PreflightError } from "./errors.js";
import type { AuditOptions } from "./types.js";

export interface PreflightResult {
  codexAvailable: boolean;
  projectRecognized: boolean;
  gitRepository: boolean;
  warnings: string[];
}

export interface PreflightDependencies {
  commandExists?: (command: string) => Promise<boolean>;
}

const PROJECT_MARKERS = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "settings.gradle",
  "composer.json",
  "Gemfile",
  "README.md",
  "readme.md",
  "src",
  "lib",
  "app"
];

export async function runPreflight(
  projectRoot: string,
  runDir: string,
  options: AuditOptions,
  dependencies: PreflightDependencies = {}
): Promise<PreflightResult> {
  const warnings: string[] = [];
  const commandExists = dependencies.commandExists ?? defaultCommandExists;

  await assertDirectoryAccess(projectRoot, "Project directory", false);
  await assertDirectoryAccess(runDir, "Report directory", true);

  const codexAvailable = await commandExists("codex");
  if (!codexAvailable) {
    throw new PreflightError(
      "Codex CLI was not found. Install and authenticate the official Codex CLI so the `codex` command is available in PATH."
    );
  }

  const projectRecognized = await isRecognizableProject(projectRoot);
  if (!projectRecognized) {
    throw new PreflightError(
      "The current directory does not look like a code project. Run RepoVista from the project root or add recognizable project files."
    );
  }

  const gitRepository = await hasGitRepository(projectRoot);
  if (!gitRepository) {
    warnings.push(
      "The target directory is not a recognizable Git repository. RepoVista passes --skip-git-repo-check so the audit can still run read-only."
    );
  }

  if (options.sandbox !== "read-only") {
    warnings.push(
      `Sandbox mode ${options.sandbox} was selected explicitly. The safe default is read-only.`
    );
  }

  if (path.resolve(projectRoot, options.outDir) === projectRoot) {
    throw new PreflightError("The report directory must not be identical to the project root.");
  }

  return {
    codexAvailable,
    projectRecognized,
    gitRepository,
    warnings
  };
}

export async function isRecognizableProject(projectRoot: string): Promise<boolean> {
  const entries = new Set(await readdir(projectRoot));
  return PROJECT_MARKERS.some((marker) => entries.has(marker));
}

export async function hasGitRepository(projectRoot: string): Promise<boolean> {
  try {
    const gitPath = path.join(projectRoot, ".git");
    const gitStat = await stat(gitPath);
    if (gitStat.isFile()) {
      return true;
    }
    if (!gitStat.isDirectory()) {
      return false;
    }
    const gitEntries = await readdir(gitPath);
    return gitEntries.includes("HEAD") || gitEntries.includes("config") || gitEntries.includes("objects");
  } catch {
    return false;
  }
}

async function assertDirectoryAccess(directory: string, label: string, requireWritable: boolean): Promise<void> {
  try {
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory()) {
      throw new PreflightError(`${label} is not a directory: ${directory}`);
    }
    await access(directory, requireWritable ? constants.R_OK | constants.W_OK : constants.R_OK);
  } catch (error) {
    if (error instanceof PreflightError) {
      throw error;
    }
    const accessDescription = requireWritable ? "not readable or not writable" : "not readable";
    throw new PreflightError(`${label} is ${accessDescription}: ${directory}`);
  }
}

async function defaultCommandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      stdio: "ignore"
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
