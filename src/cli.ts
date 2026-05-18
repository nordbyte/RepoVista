#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runAudit } from "./audit.js";
import { CliUsageError, RepoVistaError } from "./errors.js";
import { parseCliArgs, renderHelp, DEFAULT_OPTIONS } from "./options.js";
import { runInitCommand, runPlanCommand } from "./project-commands.js";
import { runSettingsMenu } from "./settings-menu.js";
import { applySettingsToDefaults, loadSettings } from "./settings-config.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseCliArgs(argv);
    const version = readPackageVersion();

    if (parsed.action === "help") {
      process.stdout.write(renderHelp());
      return 0;
    }

    if (parsed.action === "version") {
      process.stdout.write(`${version}\n`);
      return 0;
    }

    if (parsed.action === "settings") {
      await runSettingsMenu();
      return 0;
    }

    const settings = await loadSettings();
    const optionsWithSettings = parseCliArgs(argv, applySettingsToDefaults(DEFAULT_OPTIONS, settings));
    if (optionsWithSettings.action === "init") {
      process.stdout.write(await runInitCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "plan") {
      process.stdout.write(await runPlanCommand(optionsWithSettings.options));
      return 0;
    }
    const result = await runAudit(optionsWithSettings.options, { version });
    return result.exitCode;
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`Error: ${error.message}\n\n${renderHelp()}`);
      return 1;
    }

    if (error instanceof RepoVistaError) {
      process.stderr.write(`Error: ${error.message}\n`);
      return 1;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unexpected error: ${message}\n`);
    return 1;
  }
}

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

if (isMainModule()) {
  const exitCode = await main();
  process.exitCode = exitCode;
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  const invokedPath = path.resolve(process.argv[1]);
  const currentPath = path.resolve(fileURLToPath(import.meta.url));

  if (invokedPath === currentPath) {
    return true;
  }

  try {
    return realpathSync.native(invokedPath) === realpathSync.native(currentPath);
  } catch {
    return false;
  }
}
