import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RepoVistaError } from "./errors.js";
import { REPORT_PROVIDERS, getReportProvider } from "./providers/index.js";
import { getPluginProviderDiagnostics } from "./providers/plugin.js";
import { maskSensitiveText } from "./secrets.js";
import type { AuditOptions } from "./types.js";

const execFileAsync = promisify(execFile);

export async function runProvidersCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const action = options.providerAction ?? "list";
  if (action === "test") {
    const provider = getReportProvider(options.provider ?? "codex");
    try {
      const { stdout, stderr } = await execFileAsync(provider.executable, provider.versionArgs, {
        cwd: projectRoot,
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      const version = maskSensitiveText((stdout || stderr).trim());
      if (options.json) {
        return `${JSON.stringify({ provider: provider.id, available: true, version }, null, 2)}\n`;
      }
      return `${provider.displayName} (${provider.id}) is available${version ? `: ${version}` : "."}\n`;
    } catch (error) {
      const message = maskSensitiveText(error instanceof Error ? error.message : String(error));
      if (options.json) {
        return `${JSON.stringify({ provider: provider.id, available: false, error: message }, null, 2)}\n`;
      }
      throw new RepoVistaError(`${provider.displayName} (${provider.id}) is not available: ${message}`);
    }
  }

  const payload = {
    providers: REPORT_PROVIDERS.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      executable: provider.executable,
      outputMode: provider.outputMode
    })),
    pluginDiagnostics: getPluginProviderDiagnostics()
  };

  if (options.json) {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  const providerLines = payload.providers.map((provider) =>
    `- ${provider.id}: ${provider.displayName} (${provider.executable}, ${provider.outputMode})`
  );
  const diagnosticLines = payload.pluginDiagnostics.length
    ? payload.pluginDiagnostics.map((diagnostic) => [
      `- ${diagnostic.loaded ? "loaded" : "failed"} ${diagnostic.id ?? diagnostic.filePath ?? diagnostic.source}`,
      diagnostic.error ? `  error: ${diagnostic.error}` : undefined
    ].filter(Boolean).join("\n"))
    : ["- none"];

  return `RepoVista providers:\n${providerLines.join("\n")}\n\nPlugin diagnostics:\n${diagnosticLines.join("\n")}\n`;
}
