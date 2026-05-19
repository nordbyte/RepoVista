# CLI Reference

## Command Overview

```text
repovista [options]
repovista audit [options]
repovista init [options]
repovista plan [options]
repovista doctor [options]
repovista providers [list|test <provider>] [--json]
repovista profiles [--json]
repovista ci init [--template pr-light|security|release-readiness|scheduled-audit] [--dry-run] [--force]
repovista compare <old-run-dir> <new-run-dir> [--format markdown|json|html] [--fail-on-regression]
repovista review <run-dir> [--json]
repovista repair-run <run-dir> [--force] [--json]
repovista pr-comment <run-dir> [--dry-run]
repovista baseline [list|add|remove|prune] [finding-id] [--note <text>]
repovista suppress <finding-id> [--note <text>]
repovista clean-locks [--force]
repovista findings [--run <run-id|dir>] [--status <status>] [--all] [--json] [--export <formats>]
repovista findings-ui
repovista reports
repovista next [--status <status>]
repovista show <finding-id>
repovista triage <finding-id|--all> --status <status> [--note <text>]
repovista revalidate <finding-id|--all> [--provider-revalidate]
repovista issue <finding-id> [--dry-run] [--label <name>] [--assignee <login>] [--update-existing]
repovista fix <finding-id> [--dry-run] [--check <command>]
repovista patches [patch-id] [--json]
repovista open-pr <patch-id> [--dry-run] [--base <branch>] [--branch <branch>] [--title <title>]
repovista settings
repovista settings get [key]
repovista settings set <key> <value>
repovista settings reset [key]
repovista help
repovista version
```

## Commands

| Command | Purpose |
|---|---|
| `repovista`, `repovista audit` | Run an audit in the current directory. |
| `init` | Initialize or refresh `.repovista/project-map.json` and feature state. |
| `plan` | Show recommended parallel execution and stale-map warnings. |
| `doctor` | Check project, provider, plugin, workspace, settings, Git, and output readiness. |
| `providers list` | List built-in and plugin providers. |
| `providers test <provider>` | Check one provider executable and version command. |
| `profiles` | List built-in audit profiles. |
| `ci init` | Create a GitHub Actions workflow. |
| `compare` | Compare two run directories. |
| `review` | Review one run for quality, evidence, and stale checkout signals. |
| `repair-run` | Rebuild run artifacts from provider-native `.structured.json` outputs. |
| `pr-comment` | Render or post a pull request summary comment. |
| `baseline` | Manage known accepted finding suppressions. |
| `suppress` | Shortcut for `baseline add`. |
| `clean-locks` | Remove stale feature locks. |
| `findings` | List persisted findings, emit JSON, or export findings. |
| `findings-ui` | Open an interactive finding triage TUI. |
| `reports` | Browse, navigate, mark, and delete completed report runs in a TUI. |
| `next` | Show the next prioritized finding. |
| `show` | Show one finding with evidence and lifecycle history. |
| `triage` | Update one finding or all findings. |
| `revalidate` | Re-check finding evidence against the current checkout. |
| `issue` | Create or update a GitHub issue with `gh`. |
| `fix` | Create a patch attempt for one finding. |
| `patches` | List or show patch attempts. |
| `open-pr` | Create a pull request for a patch attempt. |
| `settings` | Edit, read, set, or reset persisted defaults. |

## Audit Options

| Option | Purpose |
|---|---|
| `--provider <name>` | Provider: `codex`, `claude`, `gemini`, `opencode`, `aider`, or a loaded plugin. |
| `--allow-repo-provider-plugin` | Allow execution of provider plugins declared by the current repository. |
| `--parallel <mode>` | `off`, `auto`, or `1`-`5` threads, default `auto`. |
| `--no-parallel` | Disable a saved parallel default. |
| `--out <dir>` | Output directory, default `.repovista`. |
| `--resume <run-dir>` | Resume or complete an existing run directory. |
| `--since <git-ref>` | Focus on files changed since a Git ref. |
| `--pr` | PR mode, default base `origin/main` unless `--base` is set. |
| `--no-pr` | Disable saved PR mode. |
| `--base <git-ref>` | Base ref for `--pr` or diff audits. |
| `--audit-profile <name>` | `quick`, `security`, `pr-review`, `release-readiness`, or `architecture`. |
| `--review-mode <mode>` | `default`, `deslopify`, `security`, or `test-gaps`. |
| `--prompt-file <path>` | Append additional read-only reviewer guidance. |
| `--workspace <name-or-path>` | Focus one detected workspace. |
| `--all-workspaces` | Record all detected workspaces. |
| `--incremental` | Enable scan-cache metadata and reusable phase checks, default on. |
| `--model <name>` | Override provider model. |
| `--profile <name>` | Use a provider profile, currently Codex profile for Codex. |
| `--reasoning <effort>` | Override reasoning effort, default `xhigh`. |
| `--fast` | Use fast provider tier where supported. |
| `--no-fast` | Disable fast provider tier. |
| `--sandbox <mode>` | `read-only` or `workspace-write`. |
| `--language <name>` | Report language, default `English`. |
| `--json` | Store metadata, JSON provider events, or emit JSON where supported. |
| `--include <patterns>` | Additional include patterns. |
| `--ignore <patterns>` | Additional ignore patterns. |
| `--phase <id>` | Selected phases, repeatable or comma-separated. |
| `--run-checks` | Run detected or explicit local checks before analysis, default on. |
| `--no-run-checks` | Disable saved run-checks default. |
| `--check <command>` | Add a local check command. |
| `--check-timeout <minutes>` | Timeout per check command. |
| `--timeout <minutes>` | Timeout per provider phase. |
| `--phase-timeout <minutes>` | Alias for `--timeout`. |
| `--strict-reports` | Mark phases failed on quality warnings, default on. |
| `--no-strict-reports` | Disable saved strict-report default. |
| `--repair-reports` | Ask provider to repair weak reports, default on. |
| `--no-repair-reports` | Disable saved repair default. |
| `--repair-attempts <n>` | Repair attempts per phase, `1`-`3`. |
| `--deep-review` | Run feature-sliced risk review and merge findings. |
| `--no-deep-review` | Disable saved deep-review default. |
| `--export <formats>` | `sarif`, `html`, `jsonl`, `github`; comma-separated, default `sarif,html,jsonl`. |
| `--ci` | CI-friendly mode without progress output. |
| `--fail-on-critical` | Exit `2` when critical findings are found in CI. |
| `--no-progress` | Disable the interactive progress TUI and reduce progress output. |
| `--keep-logs` | Store technical provider logs. |

Phase ids are `architecture`, `code-quality`, `risk-and-bug`, `feature-roadmap`, and `summary`.

## Finding, Baseline, Patch, and CI Options

| Option | Purpose |
|---|---|
| `--finding <id>` | Finding id for commands that need one. |
| `--run <run-id\|dir>` | Read findings from a specific run id or run directory. |
| `--status <status>` | `open`, `fixed`, `false-positive`, `wont-fix`, or `uncertain`. |
| `--note <text>` | Triage, baseline, or issue note. |
| `--all` | Include all statuses or revalidate all findings. |
| `--provider-revalidate` | Ask provider to revalidate finding status. |
| `--label <name>` | GitHub issue label, repeatable. |
| `--assignee <login>` | GitHub issue assignee, repeatable. |
| `--update-existing` | Update a matching GitHub issue instead of creating a duplicate. |
| `--patch <id>` | Patch attempt id. |
| `--branch <name>` | Branch for `open-pr`. |
| `--title <text>` | Pull request title. |
| `--dry-run` | Preview without remote writes or patch writes where supported. |
| `--isolate-branch` | Run `fix` on a temporary `repovista/fix-*` branch. |
| `--post-revalidate` | Revalidate the finding after `fix`. |
| `--max-files <n>` | Maximum changed files allowed by the fix scope gate. |
| `--template <name>` | CI template: `pr-light`, `security`, `release-readiness`, or `scheduled-audit`. |
| `--force` | Overwrite generated files or force cleanup where documented. |
| `--format <format>` | Compare output: `markdown`, `json`, or `html`. |
| `--fail-on-regression` | Compare exits `2` on new critical/high findings. |

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Command completed without a fatal or configured CI failure. |
| `1` | Command failed, an analysis phase failed, checks failed in CI, or usage was invalid. |
| `2` | Critical findings or compare regressions were found when the relevant fail flag was enabled. |
