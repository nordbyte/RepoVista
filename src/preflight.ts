import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { PreflightError } from "./errors.js";
import { commandAvailable } from "./process-runner.js";
import { getReportProvider, refreshReportProviders } from "./providers/index.js";
import { providerPluginTrustStatus } from "./providers/plugin.js";
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
  refreshReportProviders({ projectRoot });
  const provider = getReportProvider(options.provider ?? "codex");
  const pluginTrust = providerPluginTrustStatus(provider.id);
  if (pluginTrust.isPlugin && pluginTrust.trustRequired && !pluginTrust.trusted && !options.allowRepoProviderPlugin) {
    throw new PreflightError(
      `Provider plugin ${provider.id} is declared by this repository and is not trusted by default. Re-run with --allow-repo-provider-plugin after reviewing ${pluginTrust.filePath ?? "repovista.providers.json"}, or add its directory to REPOVISTA_TRUSTED_PROVIDER_PLUGIN_DIRS.`
    );
  }

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
  if (pluginTrust.isPlugin && pluginTrust.trustRequired && (pluginTrust.trusted || options.allowRepoProviderPlugin)) {
    warnings.push(`Repository provider plugin ${provider.id} is enabled for this run.`);
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
  return commandAvailable(command, args, COMMAND_EXISTS_TIMEOUT_MS);
}
