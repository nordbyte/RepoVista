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
  { usage: "repovista ci init [--dry-run] [--force]", name: "ci init", help: "Create a GitHub Actions workflow for RepoVista" },
  { usage: "repovista compare <old-run-dir> <new-run-dir> [--format markdown|json|html] [--fail-on-regression]", name: "compare", help: "Compare two RepoVista run directories" },
  { usage: "repovista review <run-dir> [--json]", name: "review", help: "Review one RepoVista run for report quality, evidence, and stale state risks" },
  { usage: "repovista pr-comment <run-dir> [--dry-run]", name: "pr-comment", help: "Render or post a pull request summary comment for a RepoVista run" },
  { usage: "repovista baseline [list|add|remove|prune] [finding-id] [--note <text>]", name: "baseline", help: "Manage baseline suppressions for known findings" },
  { usage: "repovista suppress <finding-id> [--note <text>]", name: "suppress", help: "Shortcut for adding a finding to the baseline" },
  { usage: "repovista clean-locks [--force]", name: "clean-locks", help: "Remove stale RepoVista feature locks" },
  { usage: "repovista findings [--status <status>] [--all] [--json] [--export <formats>]", name: "findings", help: "List persisted findings, emit JSON, or export them" },
  { usage: "repovista findings-ui", name: "findings-ui", help: "Open an interactive terminal UI for finding triage" },
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

export const CLI_OPTIONS: readonly CliOptionDefinition[] = [
  { name: "provider", kind: "value", help: "Report provider: codex, claude, gemini, opencode, aider, or a loaded plugin (default: codex)" },
  { name: "parallel", kind: "value", help: "Parallel audit mode: off, auto, or 1-5 threads (default: off)" },
  { name: "refresh", kind: "boolean", help: "Refresh cached project metadata for commands that support it" },
  { name: "no-parallel", kind: "boolean", help: "Disable saved parallel default" },
  { name: "out", kind: "value", help: "Report output directory (default: .repovista)" },
  { name: "resume", kind: "value", help: "Resume or complete an existing RepoVista run directory" },
  { name: "since", kind: "value", help: "Focus the audit on files changed since the given Git ref" },
  { name: "pr", kind: "boolean", help: "PR mode; default diff base is origin/main unless --base is set" },
  { name: "no-pr", kind: "boolean", help: "Disable saved PR mode" },
  { name: "base", kind: "value", help: "Base ref for --pr or diff-focused audits" },
  { name: "audit-profile", kind: "value", help: "Built-in audit profile: quick, security, pr-review, release-readiness, architecture" },
  { name: "review-mode", kind: "value", help: "Review mode: default, deslopify, security, or test-gaps" },
  { name: "prompt-file", kind: "value", help: "Append extra read-only reviewer guidance from a file" },
  { name: "workspace", kind: "value", help: "Limit the audit to a detected workspace by name or path" },
  { name: "all-workspaces", kind: "boolean", help: "Record and include all detected workspaces" },
  { name: "incremental", kind: "boolean", help: "Record scan-cache metadata and detect unchanged project scans" },
  { name: "model", kind: "value", help: "Override the provider model" },
  { name: "profile", kind: "value", help: "Use a provider configuration profile, currently Codex profile for codex" },
  { name: "reasoning", kind: "value", help: "Override provider reasoning effort" },
  { name: "fast", kind: "boolean", help: "Use Codex fast service tier when supported" },
  { name: "no-fast", kind: "boolean", help: "Disable Codex fast service tier" },
  { name: "sandbox", kind: "value", help: "Provider sandbox: read-only or workspace-write (default: read-only)" },
  { name: "language", kind: "value", help: "Report language (default: English)" },
  { name: "json", kind: "boolean", help: "Store metadata, provider logs/events, or emit command JSON where supported" },
  { name: "include", kind: "value", help: "Additional include patterns for inventory/context" },
  { name: "ignore", kind: "value", help: "Additional ignore patterns" },
  { name: "phase", kind: "value", help: "Run only selected phase(s); repeatable or comma-separated" },
  { name: "run-checks", kind: "boolean", help: "Run detected or explicit local check commands before analysis" },
  { name: "no-run-checks", kind: "boolean", help: "Disable saved run-checks default" },
  { name: "check", kind: "value", help: "Add an explicit local check command for --run-checks" },
  { name: "check-timeout", kind: "value", help: "Timeout per local check command in minutes (default: 5)" },
  { name: "timeout", kind: "value", help: "Timeout per provider phase in minutes (default: 30)" },
  { name: "phase-timeout", kind: "value", help: "Alias for --timeout" },
  { name: "strict-reports", kind: "boolean", help: "Fail phases when report quality gates warn" },
  { name: "no-strict-reports", kind: "boolean", help: "Disable saved strict report default" },
  { name: "repair-reports", kind: "boolean", help: "Ask the provider to repair reports that miss quality gates" },
  { name: "no-repair-reports", kind: "boolean", help: "Disable saved report repair default" },
  { name: "repair-attempts", kind: "value", help: "Maximum repair attempts per phase, 1-3 (default: 1)" },
  { name: "deep-review", kind: "boolean", help: "Run additional feature-sliced risk review passes and merge their findings" },
  { name: "no-deep-review", kind: "boolean", help: "Disable saved feature-sliced deep review default" },
  { name: "export", kind: "value", help: "Export findings: sarif, html, jsonl, github" },
  { name: "format", kind: "value", help: "Output format for compare: markdown, json, html" },
  { name: "fail-on-regression", kind: "boolean", help: "Exit with code 2 when compare detects new critical/high findings" },
  { name: "ci", kind: "boolean", help: "CI mode without progress output" },
  { name: "fail-on-critical", kind: "boolean", help: "Exit with code 2 in CI when critical findings are detected" },
  { name: "no-progress", kind: "boolean", help: "Reduce progress output" },
  { name: "keep-logs", kind: "boolean", help: "Store technical provider logs" },
  { name: "finding", kind: "value", help: "Finding id for show, triage, revalidate, issue, baseline, or suppress" },
  { name: "status", kind: "value", help: "Finding status: open, fixed, false-positive, wont-fix, uncertain" },
  { name: "note", kind: "value", help: "Triage, baseline, or issue note stored in command history" },
  { name: "label", kind: "value", help: "GitHub issue label; repeatable" },
  { name: "assignee", kind: "value", help: "GitHub issue assignee; repeatable" },
  { name: "update-existing", kind: "boolean", help: "Update an existing matching GitHub issue instead of creating a duplicate" },
  { name: "patch", kind: "value", help: "Patch attempt id for patches or open-pr" },
  { name: "branch", kind: "value", help: "Branch name for open-pr" },
  { name: "title", kind: "value", help: "Title for open-pr" },
  { name: "all", kind: "boolean", help: "Include all finding statuses or revalidate all findings" },
  { name: "provider-revalidate", kind: "boolean", help: "Ask the configured provider to revalidate finding status" },
  { name: "dry-run", kind: "boolean", help: "Preview commands or issue/workflow content without writing remotely" },
  { name: "force", kind: "boolean", help: "Overwrite generated files where supported" },
  { name: "version", kind: "boolean", help: "Show version" },
  { name: "help", kind: "boolean", help: "Show help" }
];

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
