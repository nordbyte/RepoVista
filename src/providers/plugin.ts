import { readFileSync } from "node:fs";
import path from "node:path";
import { maskSensitiveText } from "../secrets.js";
import type { ProviderRunRequest } from "../types.js";
import type { ProviderOutputMode, ReportProvider } from "./types.js";

interface ProviderPluginDefinition {
  id: string;
  displayName?: string;
  executable: string;
  outputMode?: ProviderOutputMode;
  versionArgs?: string[];
  args: string[];
  stdoutLogExtension?: string;
}

export function loadPluginProviders(): ReportProvider[] {
  const files = pluginFiles();
  const providers: ReportProvider[] = [];
  for (const file of files) {
    const provider = loadPluginProvider(file);
    if (provider) {
      providers.push(provider);
    }
  }
  return providers;
}

function pluginFiles(): string[] {
  const single = process.env.REPOVISTA_PROVIDER_PLUGIN ? [process.env.REPOVISTA_PROVIDER_PLUGIN] : [];
  const multiple = process.env.REPOVISTA_PROVIDER_PLUGINS
    ? process.env.REPOVISTA_PROVIDER_PLUGINS.split(path.delimiter).filter(Boolean)
    : [];
  return [...single, ...multiple].map((file) => path.resolve(file));
}

function loadPluginProvider(filePath: string): ReportProvider | undefined {
  try {
    const definition = JSON.parse(readFileSync(filePath, "utf8")) as ProviderPluginDefinition;
    if (!isValidDefinition(definition)) {
      return undefined;
    }
    return {
      id: definition.id,
      displayName: definition.displayName ?? definition.id,
      executable: definition.executable,
      outputMode: definition.outputMode ?? "stdout",
      versionArgs: definition.versionArgs ?? ["--version"],
      buildArgs: (request) => buildPluginArgs(definition, request),
      classifyError: (_stderrText, code) => `${definition.displayName ?? definition.id} run exited with code ${code ?? "unknown"}.`,
      stdoutLogExtension: () => definition.stdoutLogExtension ?? ".log"
    };
  } catch {
    return undefined;
  }
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
    fastMode: request.fastMode ? "true" : "false"
  };
  return maskSensitiveText(template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (_match, key: string) => values[key] ?? ""));
}
