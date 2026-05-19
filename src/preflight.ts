import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { PreflightError } from "./errors.js";
import { getReportProvider } from "./providers/index.js";
import { validateReportRoot } from "./reports.js";
import type { AiProviderId, AuditOptions } from "./types.js";

export interface PreflightResult {
  codexAvailable: boolean;
  providerAvailable: boolean;
  provider: {
    id: AiProviderId;
    displayName: string;
    executable: string;
    available: boolean;
  };
  projectRecognized: boolean;
  gitRepository: boolean;
  warnings: string[];
}

export interface PreflightDependencies {
  commandExists?: (command: string, args?: string[]) => Promise<boolean>;
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
const COMMAND_EXISTS_TIMEOUT_MS = 10_000;

export async function runPreflight(
  projectRoot: string,
  runDir: string,
  options: AuditOptions,
  dependencies: PreflightDependencies = {}
): Promise<PreflightResult> {
  const warnings: string[] = [];
  const commandExists = dependencies.commandExists ?? defaultCommandExists;
  const provider = getReportProvider(options.provider ?? "codex");

  await assertDirectoryAccess(projectRoot, "Project directory", false);
  await assertDirectoryAccess(runDir, "Report directory", true);
  await validateReportRoot(projectRoot, options.outDir);

  const providerAvailable = await commandExists(provider.executable, provider.versionArgs);
  if (!providerAvailable) {
    throw new PreflightError(
      `${provider.displayName} was not found. Install and authenticate ${provider.displayName} so the \`${provider.executable}\` command is available in PATH.`
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
      "The target directory is not a recognizable Git repository. RepoVista can still run a read-only audit from the current directory."
    );
  }

  if (options.sandbox !== "read-only") {
    warnings.push(
      `Sandbox mode ${options.sandbox} was selected explicitly. The safe default is read-only.`
    );
  }

  return {
    codexAvailable: provider.id === "codex" && providerAvailable,
    providerAvailable,
    provider: {
      id: provider.id,
      displayName: provider.displayName,
      executable: provider.executable,
      available: providerAvailable
    },
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

async function defaultCommandExists(command: string, args: string[] = ["--version"]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const child = spawn(command, args, {
      stdio: "ignore"
    });
    const timeoutTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 5000);
      forceKillTimer.unref();
      settle(false);
    }, COMMAND_EXISTS_TIMEOUT_MS);
    timeoutTimer.unref();

    const settle = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve(value);
    };

    child.on("error", () => settle(false));
    child.on("close", (code) => settle(code === 0));
  });
}
