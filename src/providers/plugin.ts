import { readFileSync } from "node:fs";
import path from "node:path";
import { maskSensitiveText } from "../secrets.js";
import type { ProviderCapabilities, ProviderRunRequest } from "../types.js";
import type { ProviderOutputMode, ReportProvider } from "./types.js";

interface ProviderPluginDefinition {
  id: string;
  displayName?: string;
  executable: string;
  outputMode?: ProviderOutputMode;
  versionArgs?: string[];
  args: string[];
  stdoutLogExtension?: string;
  capabilities?: Partial<ProviderCapabilities>;
}

export interface ProviderPluginDiagnostic {
  source: string;
  filePath?: string;
  id?: string;
  loaded: boolean;
  error?: string;
}

const pluginDiagnostics: ProviderPluginDiagnostic[] = [];

export function loadPluginProviders(): ReportProvider[] {
  pluginDiagnostics.length = 0;
  const entries = pluginEntries();
  const providers: ReportProvider[] = [];
  for (const entry of entries) {
    const provider = entry.definition
      ? loadPluginDefinition(entry.definition, entry.source, entry.filePath)
      : entry.filePath
        ? loadPluginProviderFile(entry.filePath, entry.source)
        : undefined;
    if (provider) {
      providers.push(provider);
    }
  }
  return providers;
}

export function getPluginProviderDiagnostics(): ProviderPluginDiagnostic[] {
  return [...pluginDiagnostics];
}

function pluginEntries(): Array<{ source: string; filePath?: string; definition?: ProviderPluginDefinition }> {
  const single = process.env.REPOVISTA_PROVIDER_PLUGIN ? [process.env.REPOVISTA_PROVIDER_PLUGIN] : [];
  const multiple = process.env.REPOVISTA_PROVIDER_PLUGINS
    ? process.env.REPOVISTA_PROVIDER_PLUGINS.split(path.delimiter).filter(Boolean)
    : [];
  const envEntries = [...single, ...multiple].map((file) => ({
    source: "environment",
    filePath: path.resolve(file)
  }));
  return [...envEntries, ...repoPluginEntries()];
}

function repoPluginEntries(): Array<{ source: string; filePath?: string; definition?: ProviderPluginDefinition }> {
  const configPath = path.resolve(process.cwd(), "repovista.providers.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { providers?: Array<string | ProviderPluginDefinition> } | ProviderPluginDefinition[];
    const providers = Array.isArray(parsed) ? parsed : parsed.providers;
    if (!Array.isArray(providers)) {
      pluginDiagnostics.push({
        source: "repo-config",
        filePath: configPath,
        loaded: false,
        error: "repovista.providers.json must be an array or contain a providers array."
      });
      return [];
    }
    return providers.map((provider, index) => typeof provider === "string"
      ? { source: "repo-config", filePath: path.resolve(path.dirname(configPath), provider) }
      : { source: `repo-config:${index + 1}`, filePath: configPath, definition: provider });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") {
      pluginDiagnostics.push({
        source: "repo-config",
        filePath: configPath,
        loaded: false,
        error: maskSensitiveText(error instanceof Error ? error.message : String(error))
      });
    }
    return [];
  }
}

function loadPluginProviderFile(filePath: string, source: string): ReportProvider | undefined {
  try {
    const definition = JSON.parse(readFileSync(filePath, "utf8")) as ProviderPluginDefinition;
    return loadPluginDefinition(definition, source, filePath);
  } catch (error) {
    pluginDiagnostics.push({
      source,
      filePath,
      loaded: false,
      error: maskSensitiveText(error instanceof Error ? error.message : String(error))
    });
    return undefined;
  }
}

function loadPluginDefinition(
  definition: ProviderPluginDefinition,
  source: string,
  filePath?: string
): ReportProvider | undefined {
  if (!isValidDefinition(definition)) {
    pluginDiagnostics.push({
      source,
      filePath,
      id: typeof definition?.id === "string" ? definition.id : undefined,
      loaded: false,
      error: "Provider plugin definition is invalid. Required fields: id, executable, args[]."
    });
    return undefined;
  }
  pluginDiagnostics.push({
    source,
    filePath,
    id: definition.id,
    loaded: true
  });
  return {
    id: definition.id,
    displayName: definition.displayName ?? definition.id,
    executable: definition.executable,
    outputMode: definition.outputMode ?? "stdout",
    versionArgs: definition.versionArgs ?? ["--version"],
    capabilities: {
      outputSchema: Boolean(definition.capabilities?.outputSchema),
      readOnlySandbox: definition.capabilities?.readOnlySandbox ?? true,
      workspaceWrite: Boolean(definition.capabilities?.workspaceWrite),
      jsonEvents: Boolean(definition.capabilities?.jsonEvents),
      promptFile: Boolean(definition.capabilities?.promptFile)
    },
    buildArgs: (request) => buildPluginArgs(definition, request),
    classifyError: (_stderrText, code) => `${definition.displayName ?? definition.id} run exited with code ${code ?? "unknown"}.`,
    stdoutLogExtension: () => definition.stdoutLogExtension ?? ".log"
  };
}

function isValidDefinition(value: ProviderPluginDefinition): boolean {
  return Boolean(
    value &&
    typeof value.id === "string" &&
    /^[a-zA-Z0-9_.-]+$/.test(value.id) &&
    typeof value.executable === "string" &&
    Array.isArray(value.args) &&
    value.args.every((item) => typeof item === "string") &&
    (!value.outputMode || value.outputMode === "stdout" || value.outputMode === "report-file")
  );
}

function buildPluginArgs(definition: ProviderPluginDefinition, request: ProviderRunRequest): string[] {
  return definition.args
    .map((arg) => renderTemplate(arg, request))
    .filter((arg) => arg.length > 0);
}

function renderTemplate(template: string, request: ProviderRunRequest): string {
  const values: Record<string, string> = {
    projectRoot: request.projectRoot,
    reportPath: request.reportPath,
    phaseId: request.phaseId,
    phaseTitle: request.phaseTitle,
    model: request.model ?? "",
    profile: request.profile ?? "",
    reasoning: request.reasoning ?? "",
    sandbox: request.sandbox,
    jsonEvents: request.jsonEvents ? "true" : "false",
    fastMode: request.fastMode ? "true" : "false",
    promptFilePath: request.promptFilePath ?? ""
  };
  return maskSensitiveText(template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (_match, key: string) => values[key] ?? ""));
}
