import { cliOptionDefinitions } from "./option-registry.js";

export interface CliOptionDefinition {
  name: string;
  kind: "value" | "boolean";
  help: string;
}

export interface CliCommandDefinition {
  usage: string;
  name: string;
  help: string;
}

export const CLI_COMMANDS: readonly CliCommandDefinition[] = [
  { usage: "repovista [options]", name: "audit", help: "Run a full audit in the current directory" },
  { usage: "repovista audit [options]", name: "audit", help: "Run a full audit in the current directory" },
  { usage: "repovista init [options]", name: "init", help: "Initialize or refresh the RepoVista project map" },
  { usage: "repovista plan [options]", name: "plan", help: "Show the recommended parallel execution plan" },
  { usage: "repovista doctor [options]", name: "doctor", help: "Check RepoVista, provider, plugin, workspace, and report-output readiness" },
  { usage: "repovista providers [list|test <provider>] [--json]", name: "providers", help: "List loaded providers or test one provider executable" },
  { usage: "repovista profiles [--json]", name: "profiles", help: "List built-in audit profiles" },
  { usage: "repovista ci init [--template pr-light|security|release-readiness|scheduled-audit] [--dry-run] [--force]", name: "ci init", help: "Create a GitHub Actions workflow for RepoVista" },
  { usage: "repovista compare <old-run-dir> <new-run-dir> [--format markdown|json|html] [--fail-on-regression]", name: "compare", help: "Compare two RepoVista run directories" },
  { usage: "repovista review <run-dir> [--json]", name: "review", help: "Review one RepoVista run for report quality, evidence, and stale state risks" },
  { usage: "repovista repair-run <run-dir> [--force] [--json]", name: "repair-run", help: "Rebuild run artifacts from provider-native .structured.json outputs" },
  { usage: "repovista pr-comment <run-dir> [--dry-run]", name: "pr-comment", help: "Render or post a pull request summary comment for a RepoVista run" },
  { usage: "repovista baseline [list|add|remove|prune] [finding-id] [--note <text>]", name: "baseline", help: "Manage baseline suppressions for known findings" },
  { usage: "repovista suppress <finding-id> [--note <text>]", name: "suppress", help: "Shortcut for adding a finding to the baseline" },
  { usage: "repovista clean-locks [--force]", name: "clean-locks", help: "Remove stale RepoVista feature locks" },
  { usage: "repovista findings [--run <run-id|dir>] [--status <status>] [--all] [--json] [--export <formats>]", name: "findings", help: "List persisted or run-specific findings, emit JSON, or export them" },
  { usage: "repovista findings-ui", name: "findings-ui", help: "Open an interactive terminal UI for finding triage" },
  { usage: "repovista reports", name: "reports", help: "Browse completed RepoVista report runs and sections in an interactive terminal UI" },
  { usage: "repovista next [--status <status>]", name: "next", help: "Show the next prioritized finding from the persistent finding state" },
  { usage: "repovista show <finding-id>", name: "show", help: "Show one persisted finding with evidence and lifecycle history" },
  { usage: "repovista triage <finding-id|--all> --status <status> [--note <text>]", name: "triage", help: "Update the lifecycle status of one finding" },
  { usage: "repovista revalidate <finding-id|--all> [--provider-revalidate]", name: "revalidate", help: "Re-check finding evidence against the current checkout" },
  { usage: "repovista issue <finding-id> [--dry-run] [--label <name>] [--assignee <login>] [--update-existing]", name: "issue", help: "Create or update a GitHub issue for one finding through gh" },
  { usage: "repovista fix <finding-id> [--dry-run] [--check <command>]", name: "fix", help: "Create a patch attempt for one finding, optionally applying it through the provider" },
  { usage: "repovista patches [patch-id] [--json]", name: "patches", help: "List or show RepoVista patch attempts" },
  { usage: "repovista open-pr <patch-id> [--dry-run] [--base <branch>] [--branch <branch>] [--title <title>]", name: "open-pr", help: "Create a pull request for a completed patch attempt" },
  { usage: "repovista settings get [key]", name: "settings", help: "Edit, read, set, or reset persisted default settings" },
  { usage: "repovista settings set <key> <value>", name: "settings", help: "Edit, read, set, or reset persisted default settings" },
  { usage: "repovista settings reset [key]", name: "settings", help: "Edit, read, set, or reset persisted default settings" }
];

export const CLI_OPTIONS: readonly CliOptionDefinition[] = cliOptionDefinitions();

export const VALUE_OPTION_NAMES = new Set(CLI_OPTIONS.filter((option) => option.kind === "value").map((option) => option.name));
export const BOOLEAN_OPTION_NAMES = new Set(CLI_OPTIONS.filter((option) => option.kind === "boolean").map((option) => option.name));

export function renderCliHelp(): string {
  const usages = unique(CLI_COMMANDS.map((command) => command.usage)).map((usage) => `  ${usage}`).join("\n");
  const commands = uniqueBy(CLI_COMMANDS, (command) => command.name)
    .map((command) => `  ${command.name.padEnd(20)} ${command.help}`)
    .join("\n");
  const options = CLI_OPTIONS
    .filter((option) => option.name !== "providers")
    .map((option) => {
      const flag = `--${option.name}${option.kind === "value" ? " <value>" : ""}`;
      return `  ${flag.padEnd(24)} ${option.help}`;
    })
    .join("\n");

  return `RepoVista - AI-powered read-only repository audits

Usage:
${usages}
  repovista help
  repovista version

Commands:
${commands}
  help                 Show help
  version              Show version

Options:
${options}
`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      continue;
    }
    seen.add(itemKey);
    result.push(value);
  }
  return result;
}
