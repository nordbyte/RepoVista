import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { commandAvailable, runProcess } from "./process-runner.js";
import { getSettingsPath, loadSettings } from "./settings-config.js";
import { detectWorkspaces } from "./workspaces.js";
import { getPluginProviderDiagnostics } from "./providers/plugin.js";
import { getReportProvider, refreshReportProviders } from "./providers/index.js";
import { resolveProviderDefaultModel } from "./provider-models.js";
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

  const registry = refreshReportProviders({ projectRoot });
  const providers = await Promise.all(registry.map(async (provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    executable: provider.executable,
    available: await commandAvailable(provider.executable, provider.versionArgs)
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

  checks.push(...await checkEffectiveProviderSettings(options, projectRoot));

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

async function checkEffectiveProviderSettings(options: AuditOptions, projectRoot: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const provider = getReportProvider(options.provider ?? "codex");
  const resolvedModel = options.model ?? await resolveProviderDefaultModel(provider.id, options).catch(() => undefined);
  checks.push({
    name: "effective-model",
    status: resolvedModel ? "ok" : "warn",
    message: resolvedModel
      ? `Effective model is ${resolvedModel}; reasoning is ${options.reasoning ?? "provider default"}.`
      : `Could not resolve an effective model for ${provider.displayName}; pass --model or configure provider defaults.`
  });
  checks.push({
    name: "provider-capabilities",
    status: options.sandbox === "workspace-write" && !provider.capabilities.workspaceWrite ? "fail" : "ok",
    message: [
      `${provider.displayName} capabilities: outputSchema=${yesNo(provider.capabilities.outputSchema)}`,
      `readOnlySandbox=${yesNo(provider.capabilities.readOnlySandbox)}`,
      `workspaceWrite=${yesNo(provider.capabilities.workspaceWrite)}`,
      `jsonEvents=${yesNo(provider.capabilities.jsonEvents)}`,
      `promptFile=${yesNo(provider.capabilities.promptFile)}`
    ].join(", ")
  });
  if (options.snapshot && !await isGitWorkTree(projectRoot)) {
    checks.push({
      name: "snapshot",
      status: "fail",
      message: "Snapshot audits require the current directory to be inside a Git work tree."
    });
  } else {
    checks.push({
      name: "snapshot",
      status: "ok",
      message: options.snapshot ? "Snapshot audits can create detached Git worktrees." : "Snapshot audits are disabled."
    });
  }
  const gateSummary = [
    options.failOnDrift ? "drift" : undefined,
    options.failOnWeakEvidence ? "weak evidence" : undefined,
    options.minQualityScore !== undefined ? `min quality ${options.minQualityScore}` : undefined,
    options.maxCritical !== undefined ? `max critical ${options.maxCritical}` : undefined,
    options.maxHigh !== undefined ? `max high ${options.maxHigh}` : undefined,
    options.maxMedium !== undefined ? `max medium ${options.maxMedium}` : undefined
  ].filter(Boolean).join(", ");
  checks.push({
    name: "ci-gates",
    status: "ok",
    message: gateSummary ? `Configured gates: ${gateSummary}.` : "No extra CI gates configured beyond command defaults."
  });
  return checks;
}

async function isGitWorkTree(projectRoot: string): Promise<boolean> {
  const result = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    timeoutMs: 5000,
    stdoutLimit: 1024,
    stderrLimit: 1024
  });
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
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
