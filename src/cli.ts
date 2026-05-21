#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ReadStream, WriteStream } from "node:tty";
import { runAudit, type AuditResult } from "./audit.js";
import { createAuditProgressController } from "./audit-progress.js";
import { compareGateViolations, compareHasRegression, runCompareCommand } from "./compare.js";
import { runBaselineCommand } from "./baseline.js";
import { runCiInitCommand } from "./ci-init.js";
import { runDoctorCommand } from "./doctor.js";
import { CliUsageError, RepoVistaError } from "./errors.js";
import {
  runNextFindingCommand,
  runCreateIssueCommand,
  runListFindingsCommand,
  runProviderRevalidateFindingCommand,
  runRevalidateFindingCommand,
  runShowFindingCommand,
  runTriageFindingCommand
} from "./finding-state.js";
import { runFindingsMenu } from "./finding-menu.js";
import { parseCliArgs, renderHelp, DEFAULT_OPTIONS } from "./options.js";
import { runFixFindingCommand, runOpenPrCommand, runPatchesCommand, runRollbackPatchCommand } from "./patch-commands.js";
import { runProvidersCommand } from "./provider-commands.js";
import { runPublishCommand } from "./publish.js";
import { runRepairRunCommand } from "./repair-run.js";
import { runReportsMenu } from "./report-browser.js";
import { runPrCommentCommand, runReviewCommand } from "./report-review.js";
import { runProfilesCommand } from "./profiles.js";
import { runInitCommand, runPlanCommand } from "./project-commands.js";
import { runCleanLocksCommand } from "./feature-state.js";
import { runSettingsGetCommand, runSettingsResetCommand, runSettingsSetCommand } from "./settings-commands.js";
import { runSettingsMenu } from "./settings-menu.js";
import { applySettingsToDefaults, loadSettings } from "./settings-config.js";
import { runWorkspaceMatrix } from "./workspace-matrix.js";
import type { AuditOptions } from "./types.js";

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
    if (parsed.action === "settings-get") {
      process.stdout.write(await runSettingsGetCommand(parsed.options));
      return 0;
    }
    if (parsed.action === "settings-set") {
      process.stdout.write(await runSettingsSetCommand(parsed.options));
      return 0;
    }
    if (parsed.action === "settings-reset") {
      process.stdout.write(await runSettingsResetCommand(parsed.options));
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
    if (optionsWithSettings.action === "doctor") {
      process.stdout.write(await runDoctorCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "providers") {
      process.stdout.write(await runProvidersCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "profiles") {
      process.stdout.write(runProfilesCommand(optionsWithSettings.options.json));
      return 0;
    }
    if (optionsWithSettings.action === "ci-init") {
      process.stdout.write(await runCiInitCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "compare") {
      process.stdout.write(await runCompareCommand(
        optionsWithSettings.options.compareOldRun ?? "",
        optionsWithSettings.options.compareNewRun ?? "",
        process.cwd(),
        { format: optionsWithSettings.options.compareFormat ?? "markdown" }
      ));
      const compareViolations = await compareGateViolations(
        optionsWithSettings.options.compareOldRun ?? "",
        optionsWithSettings.options.compareNewRun ?? "",
        process.cwd(),
        {
          maxNewCritical: optionsWithSettings.options.maxNewCritical,
          maxNewHigh: optionsWithSettings.options.maxNewHigh,
          maxNewMedium: optionsWithSettings.options.maxNewMedium
        }
      );
      if (compareViolations.length) {
        process.stderr.write(`RepoVista compare gate failed: ${compareViolations.join("; ")}\n`);
        return 2;
      }
      if (optionsWithSettings.options.compareFailOnRegression && await compareHasRegression(
        optionsWithSettings.options.compareOldRun ?? "",
        optionsWithSettings.options.compareNewRun ?? ""
      )) {
        return 2;
      }
      return 0;
    }
    if (optionsWithSettings.action === "review") {
      process.stdout.write(await runReviewCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "repair-run") {
      process.stdout.write(await runRepairRunCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "pr-comment") {
      process.stdout.write(await runPrCommentCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "baseline" || optionsWithSettings.action === "suppress") {
      process.stdout.write(await runBaselineCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "clean-locks") {
      process.stdout.write(await runCleanLocksCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "next") {
      process.stdout.write(await runNextFindingCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "findings") {
      process.stdout.write(await runListFindingsCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "findings-ui") {
      process.stdout.write(await runFindingsMenu(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "reports") {
      process.stdout.write(await runReportsMenu(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "show") {
      process.stdout.write(await runShowFindingCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "triage") {
      process.stdout.write(await runTriageFindingCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "revalidate") {
      process.stdout.write(optionsWithSettings.options.providerRevalidate
        ? await runProviderRevalidateFindingCommand(optionsWithSettings.options, { projectRoot: process.cwd() })
        : await runRevalidateFindingCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "issue") {
      process.stdout.write(await runCreateIssueCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "publish") {
      process.stdout.write(await runPublishCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "fix") {
      process.stdout.write(await runFixFindingCommand(optionsWithSettings.options, { projectRoot: process.cwd() }));
      return 0;
    }
    if (optionsWithSettings.action === "patches") {
      process.stdout.write(await runPatchesCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "rollback") {
      process.stdout.write(await runRollbackPatchCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.action === "open-pr") {
      process.stdout.write(await runOpenPrCommand(optionsWithSettings.options));
      return 0;
    }
    if (optionsWithSettings.options.githubRepo && optionsWithSettings.options.workspaceMatrix) {
      throw new CliUsageError("--github-repo cannot be combined with --workspace-matrix yet.");
    }
    if (optionsWithSettings.options.workspaceMatrix) {
      const abortController = new AbortController();
      const onInterrupt = (signal: NodeJS.Signals) => {
        if (!abortController.signal.aborted) {
          abortController.abort(new Error(`Cancelled by ${signal}.`));
        }
      };
      process.once("SIGINT", onInterrupt);
      process.once("SIGTERM", onInterrupt);
      try {
        const result = await runWorkspaceMatrix(optionsWithSettings.options, {
          version,
          abortSignal: abortController.signal
        });
        process.stdout.write(`RepoVista workspace matrix completed: ${result.runDir}\n`);
        return result.exitCode;
      } finally {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onInterrupt);
      }
    }

    const abortController = new AbortController();
    const progress = createAuditProgressController(optionsWithSettings.options, abortController);
    const onInterrupt = (signal: NodeJS.Signals) => {
      if (!abortController.signal.aborted) {
        abortController.abort(new Error(`Cancelled by ${signal}.`));
      }
    };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onInterrupt);
    progress?.start();
    let result: AuditResult | undefined;
    let runDir: string | undefined;
    let exitCode = 1;
    let errorMessage: string | undefined;
    let openReportBrowser = false;
    try {
      result = await runAudit(optionsWithSettings.options, {
        version,
        abortSignal: abortController.signal,
        loggerSink: progress
      });
      runDir = result.paths.runDir;
      exitCode = result.exitCode;
      openReportBrowser = shouldOpenPostAuditReportBrowser(optionsWithSettings.options, result);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      progress?.finish({ exitCode, runDir, error: errorMessage, suppressSummary: openReportBrowser });
    }
    if (openReportBrowser && runDir) {
      process.stdout.write(await runReportsMenu(
        optionsWithSettings.options,
        process.stdin as ReadStream,
        process.stdout as WriteStream,
        process.cwd(),
        { initialRunDir: runDir, initialScreen: "sections" }
      ));
    }
    return exitCode;
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

function shouldOpenPostAuditReportBrowser(options: AuditOptions, result: AuditResult | undefined): boolean {
  if (!result || result.exitCode !== 0 || options.ci || options.json || !options.progress) {
    return false;
  }
  return Boolean(
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    typeof (process.stdin as ReadStream).setRawMode === "function"
  );
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
