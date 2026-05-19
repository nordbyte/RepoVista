import { RepoVistaError } from "./errors.js";
import { runProcess } from "./process-runner.js";
import { REPORT_PROVIDERS, getReportProvider, refreshReportProviders } from "./providers/index.js";
import { getPluginProviderDiagnostics, providerPluginTrustStatus } from "./providers/plugin.js";
import type { AuditOptions } from "./types.js";

export async function runProvidersCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const providers = refreshReportProviders({ projectRoot });
  const action = options.providerAction ?? "list";
  if (action === "test") {
    const provider = getReportProvider(options.provider ?? "codex");
    const trust = providerPluginTrustStatus(provider.id);
    if (trust.isPlugin && trust.trustRequired && !trust.trusted && !options.allowRepoProviderPlugin) {
      throw new RepoVistaError(`Provider plugin ${provider.id} is declared by this repository. Re-run with --allow-repo-provider-plugin after reviewing it.`);
    }
    const result = await runProcess(provider.executable, provider.versionArgs, {
      cwd: projectRoot,
      timeoutMs: 10_000,
      stdoutLimit: 1024 * 1024,
      stderrLimit: 1024 * 1024
    });
    if (result.exitCode === 0) {
      const version = (result.stdout || result.stderr).trim();
      if (options.json) {
        return `${JSON.stringify({ provider: provider.id, available: true, version }, null, 2)}\n`;
      }
      return `${provider.displayName} (${provider.id}) is available${version ? `: ${version}` : "."}\n`;
    }
    const message = result.error ?? (result.stderr.trim() || `${provider.executable} exited with ${result.exitCode ?? "unknown"}.`);
    if (options.json) {
      return `${JSON.stringify({ provider: provider.id, available: false, error: message }, null, 2)}\n`;
    }
    throw new RepoVistaError(`${provider.displayName} (${provider.id}) is not available: ${message}`);
  }

  const payload = {
    providers: providers.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      executable: provider.executable,
      outputMode: provider.outputMode,
      capabilities: provider.capabilities
    })),
    pluginDiagnostics: getPluginProviderDiagnostics()
  };

  if (options.json) {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  const providerLines = payload.providers.map((provider) =>
    `- ${provider.id}: ${provider.displayName} (${provider.executable}, ${provider.outputMode}; capabilities: ${renderCapabilities(provider.capabilities)})`
  );
  const diagnosticLines = payload.pluginDiagnostics.length
    ? payload.pluginDiagnostics.map((diagnostic) => [
      `- ${diagnostic.loaded ? "loaded" : "failed"} ${diagnostic.id ?? diagnostic.filePath ?? diagnostic.source}`,
      diagnostic.error ? `  error: ${diagnostic.error}` : undefined
    ].filter(Boolean).join("\n"))
    : ["- none"];

  return `RepoVista providers:\n${providerLines.join("\n")}\n\nPlugin diagnostics:\n${diagnosticLines.join("\n")}\n`;
}

function renderCapabilities(capabilities: (typeof REPORT_PROVIDERS)[number]["capabilities"]): string {
  return Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(", ") || "basic";
}
