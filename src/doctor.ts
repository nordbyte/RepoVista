import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { getSettingsPath, loadSettings } from "./settings-config.js";
import { detectWorkspaces } from "./workspaces.js";
import { getPluginProviderDiagnostics } from "./providers/plugin.js";
import { REPORT_PROVIDERS } from "./providers/index.js";
import { hasGitRepository, isRecognizableProject } from "./preflight.js";
import { validateReportRoot } from "./reports.js";
import { maskSensitiveText } from "./secrets.js";
import type { AuditOptions } from "./types.js";

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
}

export async function runDoctorCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const checks: DoctorCheck[] = [];

  checks.push(await checkProject(projectRoot));
  checks.push(await checkGit(projectRoot));
  checks.push(await checkReportRoot(projectRoot, options));
  checks.push(await checkSettings());

  const providers = await Promise.all(REPORT_PROVIDERS.map(async (provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    executable: provider.executable,
    available: await commandExists(provider.executable)
  })));
  for (const provider of providers) {
    checks.push({
      name: `provider:${provider.id}`,
      status: provider.available ? "ok" : "fail",
      message: provider.available
        ? `${provider.displayName} executable is available: ${provider.executable}`
        : `${provider.displayName} executable was not found in PATH: ${provider.executable}`
    });
  }

  const pluginDiagnostics = getPluginProviderDiagnostics();
  for (const diagnostic of pluginDiagnostics) {
    checks.push({
      name: `plugin:${diagnostic.id ?? diagnostic.filePath ?? diagnostic.source}`,
      status: diagnostic.loaded ? "ok" : "warn",
      message: diagnostic.loaded
        ? `Plugin provider loaded from ${diagnostic.filePath ?? diagnostic.source}`
        : `Plugin provider was not loaded: ${diagnostic.error ?? "invalid definition"}`
    });
  }

  const workspaces = await detectWorkspaces(projectRoot);
  checks.push({
    name: "workspaces",
    status: workspaces.warnings.length ? "warn" : "ok",
    message: workspaces.detected
      ? `Detected ${workspaces.workspaces.length} workspace(s).`
      : "No package workspaces detected."
  });

  const payload = {
    projectRoot,
    checks,
    providers,
    pluginDiagnostics,
    workspaces
  };

  if (options.json) {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  return `RepoVista doctor\n\n${checks.map((check) => `${statusIcon(check.status)} ${check.name}: ${check.message}`).join("\n")}\n`;
}

async function checkProject(projectRoot: string): Promise<DoctorCheck> {
  try {
    const recognized = await isRecognizableProject(projectRoot);
    return {
      name: "project",
      status: recognized ? "ok" : "fail",
      message: recognized ? "Current directory looks like a code project." : "Current directory does not look like a supported code project."
    };
  } catch (error) {
    return {
      name: "project",
      status: "fail",
      message: maskSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

async function checkGit(projectRoot: string): Promise<DoctorCheck> {
  const git = await hasGitRepository(projectRoot);
  return {
    name: "git",
    status: git ? "ok" : "warn",
    message: git ? "Git repository detected." : "No .git directory detected; audits can still run without git metadata."
  };
}

async function checkReportRoot(projectRoot: string, options: AuditOptions): Promise<DoctorCheck> {
  try {
    const outRoot = await validateReportRoot(projectRoot, options.outDir);
    return {
      name: "report-root",
      status: "ok",
      message: `Report root is valid: ${outRoot}`
    };
  } catch (error) {
    return {
      name: "report-root",
      status: "fail",
      message: maskSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

async function checkSettings(): Promise<DoctorCheck> {
  const settingsPath = getSettingsPath();
  try {
    await loadSettings(settingsPath);
    try {
      await access(settingsPath, constants.R_OK | constants.W_OK);
      return {
        name: "settings",
        status: "ok",
        message: `Settings file is readable and writable: ${settingsPath}`
      };
    } catch {
      return {
        name: "settings",
        status: "ok",
        message: `Settings file does not exist yet; it will be created at ${settingsPath}`
      };
    }
  } catch (error) {
    return {
      name: "settings",
      status: "warn",
      message: maskSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    const timeout = setTimeout(() => {
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
    }, 10_000);
    timeout.unref();

    const settle = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve(value);
    };

    child.on("error", () => settle(false));
    child.on("close", (code) => settle(code === 0));
  });
}

function statusIcon(status: DoctorCheck["status"]): string {
  if (status === "ok") {
    return "OK";
  }
  if (status === "warn") {
    return "WARN";
  }
  return "FAIL";
}
