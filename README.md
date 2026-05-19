# RepoVista

![RepoVista Banner](docs/repovista.png)

[![Latest release](https://img.shields.io/github/v/release/nordbyte/RepoVista?style=flat-square)](https://github.com/nordbyte/RepoVista/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/nordbyte/RepoVista/ci.yml?branch=main&style=flat-square)](https://github.com/nordbyte/RepoVista/actions/workflows/ci.yml) [![Security](https://img.shields.io/github/actions/workflow/status/nordbyte/RepoVista/security.yml?branch=main&label=security&style=flat-square)](https://github.com/nordbyte/RepoVista/actions/workflows/security.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-ffd60a?style=flat-square)](LICENSE) [![npm](https://img.shields.io/npm/v/repovista?logo=npm&logoColor=white&style=flat-square)](https://www.npmjs.com/package/repovista) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white&style=flat-square)](package.json) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white&style=flat-square)](tsconfig.json)

RepoVista is an npm-installable CLI tool that orchestrates structured, read-only AI audits in the current project directory. It first collects a compact local project inventory, then runs several specialized analysis phases through a provider CLI such as Codex CLI or Claude Code CLI and writes the results as Markdown reports to `.repovista/<run-id>`.

RepoVista is not a replacement for manual reviews, tests, SAST scanners, dependency audits, or security assessments. It is a fast entry point for understanding a repository's architecture, quality, risks, bugs, and useful improvement opportunities.

## Requirements

- Node.js 20 or newer.
- A separately installed and authenticated provider CLI:
  - Codex CLI with the `codex` command available in `PATH`, or
  - Claude Code CLI with the `claude` command available in `PATH`.
- Permission and privacy clearance for the repository being analyzed.

RepoVista does not install provider CLIs through a postinstall script and does not enable telemetry.

## Installation

Install from npm:

```sh
npm install -g repovista
```

RepoVista is also published to GitHub Packages as `@nordbyte/repovista` for releases. Configure npm for GitHub Packages if you want to install that mirror:

```sh
npm config set @nordbyte:registry https://npm.pkg.github.com
npm install -g @nordbyte/repovista
```

## Usage

Run from the project root:

```sh
repovista
```

The explicit audit command is equivalent:

```sh
repovista audit
```

Edit persisted defaults in an interactive terminal menu:

```sh
repovista settings
```

Initialize the repository before using parallel planning:

```sh
repovista init
repovista plan
```

Examples:

```sh
repovista audit --language English --model gpt-5.5
repovista audit --provider claude --model sonnet --reasoning high
repovista audit --audit-profile release-readiness
repovista audit --workspace packages/api --incremental
repovista audit --parallel auto
repovista audit --parallel 3
repovista audit --out reports/repovista --keep-logs
repovista audit --ci --json --fail-on-critical --no-progress
repovista audit --run-checks --strict-reports
repovista audit --repair-reports --export sarif,html,jsonl,github
repovista audit --phase risk-and-bug --deep-review
repovista audit --resume .repovista/2026-05-18T14-57-32-123Z
repovista audit --phase risk-and-bug --phase summary
repovista audit --since origin/main
repovista audit --pr --base main
repovista doctor
repovista providers list
repovista providers test codex
repovista profiles
repovista ci init --dry-run
repovista compare .repovista/old-run .repovista/new-run --format json --fail-on-regression
repovista findings --json
repovista findings --export sarif
repovista next
repovista show fnd_abc123def456
repovista triage fnd_abc123def456 --status fixed --note "validated"
repovista triage --all --status uncertain --note "needs review"
repovista revalidate fnd_abc123def456
repovista revalidate fnd_abc123def456 --provider-revalidate
repovista baseline add fnd_abc123def456 --note "accepted risk"
repovista suppress fnd_abc123def456 --note "accepted risk"
repovista issue fnd_abc123def456 --label repovista --update-existing --dry-run
repovista settings get model
repovista settings set reasoning xhigh
repovista settings reset reasoning
```

## Report Structure

Each run creates its own timestamped folder:

```text
.repovista/
  baseline.json
  cache/
  findings/
  project-map.json
  2026-05-18T14-57-32-123Z/
    00-inventory.md
    01-architecture-report.md
    02-code-quality-report.md
    03-risk-and-bug-report.md
    04-feature-roadmap.md
    features.json
    findings.json
    findings.jsonl
    findings.sarif
    github-annotations.json
    report.json
    report.html
    index.md
    meta.json
    prompt-manifest.json
    structured-reports.json
    summary.json
    shards/
    logs/
```

`project-map.json` is written by `repovista init` and stores the repository areas, semantic features, recommended thread count, and default shard assignments. `.repovista/findings/` stores the persistent finding lifecycle state across runs. `baseline.json` stores accepted suppressions, and `cache/project-scan.json` stores the latest project scan fingerprint for incremental runs. `index.md` is the entry point for each audit run. The detail reports cover architecture, code quality, risks/bugs/security, and the feature roadmap. `00-inventory.md` includes the project inventory and an evidence pack with runtime, package, Git, selected AI provider, and optional local check results. `features.json` stores the run-specific semantic feature map and optional diff scope. `findings.json` contains active structured risk findings extracted from the risk report's RepoVista findings schema sentinel, with Markdown fields as a fallback for older reports. `report.json` is the complete machine-readable run artifact with metadata, evidence, findings, suppressed findings, structured phase reports, prompt manifest, workspace metadata, and cache metadata. `structured-reports.json` stores normalized phase schemas for architecture, code quality, risk, roadmap, and summary phases. `prompt-manifest.json` records prompt sizes, approximate token counts, project file hashes where available, inclusion reasons, omitted files, truncation reasons, semantic features, and diff scope. `summary.json` contains machine-readable run, phase, finding, provider, parallel, evidence, and output summaries. `meta.json` records provider and parallel execution settings, including provider, model, reasoning effort, fast mode, profile, sandbox, phase status, shard status, deep-review shard status, report quality score, report quality warnings, workspace scope, cache status, and preflight information. `findings.jsonl`, `findings.sarif`, `github-annotations.json`, and the full `report.html` are written when requested with `--export`. `shards/` is created when a shardable phase runs in parallel. `deep-review/` is created when risk deep review runs feature-sliced follow-up passes. `logs/` is created only with `--keep-logs` or `--json`.

## Comparing Reports

Compare two finished run directories without external scripts:

```sh
repovista compare .repovista/2026-05-18T14-57-32-123Z .repovista/2026-05-18T16-20-41-009Z
```

The comparison prints Markdown with provider/model/reasoning metadata, finding count deltas, added/resolved/persisting findings, report line and evidence-reference deltas, and phase quality status.

Use `--format json` or `--format html` for machine-readable or browser output. `--fail-on-regression` exits with code `2` when the new run adds critical or high findings.

## Finding Workflow

RepoVista assigns stable `fnd_<hash>` finding ids from severity, title, category, affected paths, and evidence references. New audits update `.repovista/findings/` so findings can be triaged and revalidated independently from a single report run.

```sh
repovista next
repovista next --status uncertain
repovista show fnd_abc123def456
repovista triage fnd_abc123def456 --status false-positive --note "not reachable in production"
repovista triage --all --status uncertain --note "bulk review pass"
repovista revalidate fnd_abc123def456
repovista revalidate --all
repovista revalidate fnd_abc123def456 --provider-revalidate
repovista findings --json
repovista findings --export sarif,github
repovista baseline list
repovista baseline add fnd_abc123def456 --note "accepted risk"
repovista baseline remove fnd_abc123def456
repovista baseline prune
repovista issue fnd_abc123def456 --dry-run
```

Evidence validation checks that referenced paths stay inside the project root, exist, and optionally match line ranges or quotes from schema-based `evidenceReferences`. Local revalidation is read-only: valid evidence keeps a finding open, missing or changed evidence marks it fixed when all references disappeared, and weak evidence marks it uncertain. Provider revalidation asks the configured provider for a read-only status decision and stores the revalidation report under `.repovista/revalidations/`. `repovista issue` uses the GitHub CLI (`gh`) and supports `--dry-run` for previewing the issue body.

Baseline suppressions remove accepted findings from active run outputs and record them as suppressed findings in `report.json`, `summary.json`, and `meta.json`. Issue creation deduplicates existing issues by finding id; use `--update-existing` to add a fresh comment and update labels or assignees instead of creating another issue.

## Doctor, Profiles, and Workspaces

Use `repovista doctor` before long runs to check project recognition, report output safety, settings, provider executables, plugin diagnostics, Git state, and detected workspaces. `repovista providers list` shows built-in and plugin providers, and `repovista providers test <provider>` runs the provider version command with a timeout.

Built-in audit profiles tune phases and defaults:

- `quick`: risk plus summary for a fast orientation pass.
- `security`: risk-heavy strict run with checks, repair, and CI-friendly exports.
- `pr-review`: diff-focused PR review with checks and GitHub annotations.
- `release-readiness`: full strict pre-release audit with checks, repair, parallel mode, and all exports.
- `architecture`: architecture plus roadmap focus.

Workspace detection reads npm/yarn package workspaces and `pnpm-workspace.yaml`. Use `--workspace <name-or-path>` to focus inventory and scan metadata on one workspace, or `--all-workspaces` to record the full workspace map.

## CLI Options

| Option | Purpose |
|---|---|
| `--provider <name>` | Report provider, `codex`, `claude`, or a loaded plugin, default `codex` |
| `--parallel <mode>` | Parallel audit mode, `off`, `auto`, or `1`-`5` threads, default `off` |
| `--no-parallel` | Disable a saved parallel default |
| `--out <dir>` | Report output directory, default `.repovista` |
| `--resume <run-dir>` | Resume or complete an existing RepoVista run directory |
| `--since <git-ref>` | Focus the audit on files changed since the given Git ref |
| `--pr` | PR mode with `origin/main` as the default diff base unless `--base` is set |
| `--base <git-ref>` | Base ref for PR or diff-focused audits |
| `--audit-profile <name>` | Apply a built-in profile: `quick`, `security`, `pr-review`, `release-readiness`, or `architecture` |
| `--workspace <name-or-path>` | Focus scan metadata and inventory includes on one detected workspace |
| `--all-workspaces` | Record all detected workspaces in metadata |
| `--incremental` | Enable scan-cache reuse using file hashes and the previous run fingerprint |
| `--model <name>` | Override the provider model |
| `--profile <name>` | Use a Codex configuration profile |
| `--reasoning <effort>` | Override provider reasoning effort |
| `--fast` | Use Codex fast service tier when supported |
| `--no-fast` | Disable Codex fast service tier |
| `--sandbox <mode>` | Provider sandbox intent, `read-only` or `workspace-write`, default `read-only` |
| `--language <name>` | Report language, default `English` |
| `--json` | Store metadata and provider logs/events |
| `--include <patterns>` | Include additional inventory/context patterns, including selected generated folders |
| `--ignore <patterns>` | Additional ignore patterns for inventory and context |
| `--phase <id>` | Run only selected phases; repeatable or comma-separated. IDs: `architecture`, `code-quality`, `risk-and-bug`, `feature-roadmap`, `summary` |
| `--run-checks` | Run detected or explicit local check commands before analysis and include results in the evidence pack |
| `--no-run-checks` | Disable a saved `runChecks` default |
| `--check <command>` | Add an explicit local check command for `--run-checks`; repeatable |
| `--check-timeout <minutes>` | Timeout per local check command, default `5` |
| `--timeout <minutes>` | Timeout per provider phase, default `30` |
| `--phase-timeout <minutes>` | Alias for `--timeout` |
| `--strict-reports` | Mark phases failed when report quality gates detect missing required sections or weak evidence |
| `--no-strict-reports` | Disable a saved strict report default |
| `--repair-reports` | Run a provider repair pass when a report misses quality gates |
| `--repair-attempts <n>` | Maximum repair attempts per phase, `1`-`3`, default `1` |
| `--deep-review` | Run additional feature-sliced risk review passes and merge/deduplicate schema findings |
| `--no-deep-review` | Disable a saved deep-review default |
| `--export <formats>` | Export findings as `sarif`, `html`, `jsonl`, or `github`; comma-separated |
| `--format <format>` | Compare output format: `markdown`, `json`, or `html` |
| `--fail-on-regression` | Return exit code `2` from compare when new critical/high findings appear |
| `--ci` | CI-friendly mode without progress output |
| `--fail-on-critical` | Return exit code `2` in CI when critical findings are detected |
| `--no-progress` | Reduce progress output |
| `--keep-logs` | Store technical provider logs |
| `--finding <id>` | Finding id for `show`, `triage`, or `revalidate` |
| `--status <status>` | Finding status: `open`, `fixed`, `false-positive`, `wont-fix`, or `uncertain` |
| `--note <text>` | Triage note stored in finding history |
| `--all` | Include all finding statuses or revalidate all findings |
| `--provider-revalidate` | Use the configured provider for finding revalidation |
| `--label <name>` | Add a GitHub issue label; repeatable |
| `--assignee <login>` | Add a GitHub issue assignee; repeatable |
| `--update-existing` | Comment on an existing issue for the finding id instead of creating a duplicate |
| `--dry-run` | Preview GitHub issue or workflow creation without writing remotely |
| `--force` | Overwrite generated files where supported, currently `repovista ci init` |
| `--version` | Show version |
| `--help` | Show help |

## Security Model

RepoVista is an audit tool by default, not an auto-fix tool.

- Providers are started with read-only intent by default.
- `danger-full-access` and full-access variants are rejected in the MVP.
- RepoVista itself writes only to the report directory.
- `--run-checks` is opt-in because project check commands can execute repository scripts and may create build/test artifacts.
- Old `.repovista` reports, dependencies, build artifacts, caches, coverage, media assets, and archives are excluded from the inventory.
- `--include` can intentionally add selected ignored paths back to the inventory, except VCS metadata and the active report directory.
- Sensitive values in read metadata are masked; `.env` contents are not included in reports.
- There is no automatic provider CLI installation, no destructive commands, and no telemetry.

Important: The selected provider CLI can access the repository during analysis and may send source code to its configured AI service. Use RepoVista only in repositories where you have the required permissions and privacy clearance.

## Provider Adapters

RepoVista checks whether the selected provider executable is available before the audit starts. The target directory is always the current working directory where `repovista` is executed.

Codex is the default provider:

- `--cd <current project directory>`
- `--config approval_policy="never"` for non-interactive runs
- `--sandbox read-only` by default
- `--skip-git-repo-check`, so intentionally non-git project folders can still be analyzed
- `--output-last-message <report.md>`, so the final answer is separated cleanly from the technical stream
- `--config model_reasoning_effort="<effort>"` when a reasoning default or CLI override is set
- `--config service_tier="fast"` when fast mode is enabled
- A default 30-minute timeout per phase, configurable with `--timeout`

Claude Code can be selected with `--provider claude`. RepoVista uses non-interactive print mode and writes Claude's final stdout to the report file:

- `--print`
- `--output-format text`
- `--input-format text`
- `--no-session-persistence`
- `--permission-mode plan` for `read-only`
- `--permission-mode default` for `workspace-write`
- `--add-dir <current project directory>`
- `--model <model>` when a model is set, for example `sonnet`, `opus`, or a full Claude model name
- `--effort <effort>` when reasoning is set; Claude Code currently supports `low`, `medium`, `high`, `xhigh`, and `max`

## Project Initialization and Parallel Audits

Run `repovista init` once from the project root before enabling parallel audits. It writes `.repovista/project-map.json` with a compact project map: detected areas, languages, frameworks, package managers, file counts, and recommended thread assignments.

`repovista plan` reads that project map and prints the current recommendation. Use it after larger refactors or directory changes to decide whether `--parallel auto` is useful.

Parallel execution is provider-neutral. Codex and Claude Code both run as independent provider sessions. RepoVista uses a map/reduce flow for shardable detail phases:

- Map: each thread receives one shard with explicit path ownership and writes a partial report under `shards/<phase>/<thread>.md`.
- Reduce: one synthesis session combines successful shard reports into the normal phase report, such as `01-architecture-report.md`.
- Summary: `index.md` stays single-threaded because it depends on the final detail reports.

Parallel mode requires an initialized project map. If the map is missing, run `repovista init` first or use `--parallel off`. Resume can reuse shard reports only when the previous `meta.json` marked the shard as successful and the shard file is still readable.

`--deep-review` applies the same project map to the risk phase. RepoVista first runs the normal broad risk report, then starts focused risk-review passes for the most useful feature shards, writes them under `deep-review/risk-and-bug/`, and appends a merged schema block to `03-risk-and-bug-report.md`.

## Evidence and Quality Gates

Before provider phases start, RepoVista writes an evidence pack into `00-inventory.md`. It records Node.js, npm, package metadata, Git branch/commit/dirty state, selected provider CLI version, and optional local check results.

When `--run-checks` is set, RepoVista runs explicit `--check` commands or detected npm scripts in this order when present: `typecheck`, `lint`, `test`, `security:audit`. Results are included in the evidence pack. In CI mode, failed checks make the run exit with code `1`.

RepoVista validates each generated Markdown report for expected sections and concrete evidence. The gates also check minimum report depth signals such as path evidence counts, a minimum roadmap proposal count, required proposal fields, risk finding schema validity, exact evidence references, and wording that distinguishes provider-side read-only context from completed Evidence Pack checks. Roadmap gates prefer the structured phase schema when present. Quality warnings and a quality score are recorded in `meta.json`; with `--strict-reports`, a phase with quality warnings is marked failed. With `--repair-reports`, RepoVista can ask the provider to rewrite a report using the concrete quality-gate warnings. Risk reports always get one automatic repair attempt when the findings schema is missing or evidence references are invalid.

The risk report is also parsed into `findings.json`. The primary source is a RepoVista findings schema sentinel (`<!-- repovista-findings:start -->` and `<!-- repovista-findings:end -->`) with title, severity, category, lifecycle status, stable signature, affected paths, evidence, evidence references, problem rationale, recommended fix, reproduction, suggested regression test, minimum fix scope, effort, confidence, and optional parent/child finding structure. `evidenceReferences` can be strings or objects with `path`, `startLine`, `endLine`, `quote`, and `symbol`; RepoVista validates these references after the provider phase. Older Markdown field extraction remains as a compatibility fallback.

## Diff Audits

Use `--since <git-ref>` for focused audits of a branch or change set:

```sh
repovista audit --since origin/main
repovista audit --since v0.1.0 --phase risk-and-bug --phase summary
repovista audit --pr --base main
```

RepoVista runs a name-status diff for `<ref>...HEAD`, stores changed files plus added/modified/deleted/renamed status in `features.json` and `prompt-manifest.json`, and tells providers to prioritize changed files while still considering cross-file dependencies. `--pr` defaults to `origin/main`; use `--base <ref>` to select a different target branch.

## Settings

`repovista settings` opens an interactive menu. Use arrow keys to move, Space to select or clear an option, and Enter to return to the previous menu or save from the main menu.

Non-interactive settings commands are available for scripts and CI images:

```sh
repovista settings get
repovista settings get model
repovista settings set model gpt-5.5
repovista settings set reasoning xhigh
repovista settings set exportFormats sarif,html
repovista settings reset reasoning
repovista settings reset
```

The provider menu lets you choose Codex CLI or Claude Code CLI. For Codex, model and reasoning menus are populated from the installed Codex CLI via `codex debug models`; if that command is unavailable, RepoVista falls back to a bundled Codex list. For Claude Code, RepoVista offers the common Claude aliases `sonnet`, `opus`, and `haiku`, plus the reasoning efforts exposed by Claude Code: `low`, `medium`, `high`, `xhigh`, and `max`.

Settings are stored in `~/.config/repovista/settings.json` by default. Set `REPOVISTA_CONFIG=/path/to/settings.json` to use a different settings file.

CLI flags always override saved settings for the current run.

The settings menu and non-interactive settings commands can persist provider, parallel mode, deep-review mode, audit profile, workspace defaults, incremental scan cache, model, reasoning, Codex profile, Codex fast mode, sandbox, language, output directory, include/ignore patterns, local check behavior, check commands, timeouts, strict report gates, repair behavior, export formats, JSON/log settings, CI mode, and critical-finding behavior.

## Provider Plugins

Codex CLI and Claude Code CLI are built in. Additional provider adapters can be registered with JSON plugin definitions through `REPOVISTA_PROVIDER_PLUGIN=/path/provider.json`, `REPOVISTA_PROVIDER_PLUGINS=/path/a.json:/path/b.json`, or a repository-local `repovista.providers.json`.

```json
{
  "id": "example",
  "displayName": "Example Provider",
  "executable": "example-ai",
  "outputMode": "stdout",
  "versionArgs": ["--version"],
  "args": ["run", "--cwd", "{projectRoot}", "--model", "{model}"]
}
```

Provider prompts are sent on stdin. Use `outputMode: "stdout"` when the provider prints the final report, or `outputMode: "report-file"` when the provider writes to `{reportPath}` itself. Supported templates include `{projectRoot}`, `{reportPath}`, `{phaseId}`, `{phaseTitle}`, `{model}`, `{profile}`, `{reasoning}`, `{sandbox}`, `{jsonEvents}`, and `{fastMode}`.

Run `repovista providers list --json` or `repovista doctor --json` to inspect plugin load diagnostics. Invalid provider definitions are reported instead of being silently ignored.

## CI Notes

For CI/CD:

```sh
repovista ci init
repovista audit --ci --json --fail-on-critical
```

Exit codes:

- `0`: Audit completed without a critical CI gate.
- `1`: At least one analysis phase failed or a fatal error occurred.
- `2`: `--ci --fail-on-critical` was set and the risk report contains critical findings.

Reports can be stored as CI artifacts from the selected `--out` directory.

## Typical Workflows

- Understand an unfamiliar repository: run `repovista`, then read `.repovista/<run-id>/index.md`.
- Initialize and inspect parallel planning: `repovista init && repovista plan`.
- Run a parallel audit after initialization: `repovista audit --parallel auto`.
- Prepare a higher-signal report: run `repovista audit --run-checks --strict-reports`.
- Review a branch diff: `repovista audit --since origin/main`.
- Continue an interrupted run: `repovista audit --resume .repovista/<run-id>`.
- Rerun only the risk report and summary: `repovista audit --resume .repovista/<run-id> --phase risk-and-bug --phase summary`.
- Compare two reports: `repovista compare .repovista/<old-run-id> .repovista/<new-run-id>`.
- Work through findings: `repovista next`, then `repovista show <id>`, `repovista triage <id> --status fixed`, or `repovista revalidate <id>`.
- Suppress accepted findings: `repovista baseline add <id> --note "accepted risk"`.
- Check setup before a long run: `repovista doctor`.
- Create a GitHub Actions workflow: `repovista ci init`.
- Configure persistent defaults: run `repovista settings`, choose a model with Space, return with Enter, then save.
- Run with Claude Code: `repovista audit --provider claude --model sonnet --reasoning high`.
- Keep technical logs for troubleshooting: `repovista audit --keep-logs`.
- Generate reports in a specific language: `repovista audit --language Spanish`.
- Ignore additional generated folders: `repovista audit --ignore "fixtures/generated/**"`.

## Troubleshooting

`Codex CLI was not found`
: Install and authenticate Codex separately. Then check `codex --version`.

`Codex CLI appears to be unauthenticated`
: Sign in to the Codex CLI and start the audit again.

`Claude Code CLI was not found`
: Install and authenticate Claude Code separately. Then check `claude --version`.

`Claude Code CLI appears to be unauthenticated`
: Sign in to Claude Code or configure an Anthropic API key and start the audit again.

`The current directory does not look like a code project`
: Run RepoVista from the project root. Recognized markers include `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `README.md`, `src/`, `lib/`, or `app/`.

`Sandbox mode rejected`
: Use `read-only` or, only by conscious choice, `workspace-write`. RepoVista is not intended for automatic code changes in the MVP.

Very large repositories
: RepoVista shortens the inventory and marks omitted entries. The selected provider can still read the repository itself, but receives compact orientation context.

## Development

```sh
npm install
npm run typecheck
npm test
```

The unit tests do not call provider CLIs for real. Codex and Claude provider paths are tested with mocked processes.
