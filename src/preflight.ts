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

  await assertDirectoryAccess(projectRoot, "Projektverzeichnis", false);
  await assertDirectoryAccess(runDir, "Reportverzeichnis", true);

  const codexAvailable = await commandExists("codex");
  if (!codexAvailable) {
    throw new PreflightError(
      "Codex CLI wurde nicht gefunden. Installiere und authentifiziere die offizielle Codex CLI, sodass der Befehl `codex` im PATH verfügbar ist."
    );
  }

  const projectRecognized = await isRecognizableProject(projectRoot);
  if (!projectRecognized) {
    throw new PreflightError(
      "Das aktuelle Verzeichnis sieht nicht wie ein Codeprojekt aus. Führe RepoVista im Projektroot aus oder ergänze erkennbare Projektdateien."
    );
  }

  const gitRepository = await hasGitRepository(projectRoot);
  if (!gitRepository) {
    warnings.push(
      "Das Zielverzeichnis ist kein erkennbares Git-Repository. RepoVista übergibt Codex --skip-git-repo-check, damit der Audit trotzdem read-only ausgeführt werden kann."
    );
  }

  if (options.sandbox !== "read-only") {
    warnings.push(
      `Sandbox-Modus ${options.sandbox} wurde explizit gewählt. Der sichere Standard ist read-only.`
    );
  }

  if (path.resolve(projectRoot, options.outDir) === projectRoot) {
    throw new PreflightError("Der Reportordner darf nicht identisch mit dem Projektroot sein.");
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
      throw new PreflightError(`${label} ist kein Verzeichnis: ${directory}`);
    }
    await access(directory, requireWritable ? constants.R_OK | constants.W_OK : constants.R_OK);
  } catch (error) {
    if (error instanceof PreflightError) {
      throw error;
    }
    const accessDescription = requireWritable ? "nicht lesbar oder nicht beschreibbar" : "nicht lesbar";
    throw new PreflightError(`${label} ist ${accessDescription}: ${directory}`);
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
