# RepoVista

RepoVista is an npm-installable CLI tool that orchestrates a structured, read-only Codex audit in the current project directory. It first collects a compact local project inventory, then runs several specialized `codex exec` phases and writes the results as Markdown reports to `.repovista/<run-id>`.

RepoVista is not a replacement for manual reviews, tests, SAST scanners, dependency audits, or security assessments. It is a fast entry point for understanding a repository's architecture, quality, risks, bugs, and useful improvement opportunities.

## Requirements

- Node.js 20 or newer.
- A separately installed and authenticated official Codex CLI.
- The `codex` command must be available in `PATH`.
- Permission and privacy clearance for the repository being analyzed.

RepoVista does not install Codex through a postinstall script and does not enable telemetry.

## Installation

From a local checkout:

```sh
npm install
npm run build
npm link
```

After publication:

```sh
npm install -g repovista
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

Examples:

```sh
repovista audit --language English --model gpt-5.5
repovista audit --out reports/repovista --keep-logs
repovista audit --ci --json --fail-on-critical --no-progress
```

## Report Structure

Each run creates its own timestamped folder:

```text
.repovista/
  2026-05-18T14-57-32-123Z/
    00-inventory.md
    01-architecture-report.md
    02-code-quality-report.md
    03-risk-and-bug-report.md
    04-feature-roadmap.md
    index.md
    meta.json
    logs/
```

`index.md` is the entry point. The detail reports cover architecture, code quality, risks/bugs/security, and the feature roadmap. `meta.json` contains run options, phase status, and preflight information. `logs/` is created only with `--keep-logs` or `--json`.

## CLI Options

| Option | Purpose |
|---|---|
| `--out <dir>` | Report output directory, default `.repovista` |
| `--model <name>` | Override the Codex model |
| `--profile <name>` | Use a Codex configuration profile |
| `--reasoning <effort>` | Override Codex reasoning effort |
| `--fast` | Use Codex fast service tier when supported |
| `--no-fast` | Disable Codex fast service tier |
| `--sandbox <mode>` | Codex sandbox, `read-only` or `workspace-write`, default `read-only` |
| `--language <name>` | Report language, default `English` |
| `--json` | Store metadata and Codex JSONL events |
| `--include <patterns>` | Document additional include patterns for inventory/context |
| `--ignore <patterns>` | Additional ignore patterns for inventory and context |
| `--ci` | CI-friendly mode without progress output |
| `--fail-on-critical` | Return exit code `2` in CI when critical findings are detected |
| `--no-progress` | Reduce progress output |
| `--keep-logs` | Store technical Codex logs |
| `--version` | Show version |
| `--help` | Show help |

## Security Model

RepoVista is an audit tool by default, not an auto-fix tool.

- Codex is started with `--sandbox read-only` by default.
- `danger-full-access` and full-access variants are rejected in the MVP.
- RepoVista itself writes only to the report directory.
- Old `.repovista` reports, dependencies, build artifacts, caches, coverage, media assets, and archives are excluded from the inventory.
- Sensitive values in read metadata are masked; `.env` contents are not included in reports.
- There is no automatic Codex installation, no destructive commands, and no telemetry.

Important: Codex can access the repository during analysis and may send source code to the configured Codex service. Use RepoVista only in repositories where you have the required permissions and privacy clearance.

## Codex CLI Dependency

RepoVista checks whether `codex` is available before the audit starts. Analysis phases are started through `codex exec`. The target directory is always the current working directory where `repovista` is executed.

RepoVista sets these Codex options:

- `--cd <current project directory>`
- `--config approval_policy="never"` for non-interactive runs
- `--sandbox read-only` by default
- `--skip-git-repo-check`, so intentionally non-git project folders can still be analyzed
- `--output-last-message <report.md>`, so the final answer is separated cleanly from the technical stream
- `--config model_reasoning_effort="<effort>"` when a reasoning default or CLI override is set
- `--config service_tier="priority"` when fast mode is enabled

## Settings

`repovista settings` opens an interactive menu. Use arrow keys to move, Space to select or clear an option, and Enter to return to the previous menu or save from the main menu.

The model and reasoning menus are populated from the installed Codex CLI via `codex debug models`. If that command is unavailable, RepoVista falls back to a bundled list for the current supported Codex models.

Settings are stored in `~/.config/repovista/settings.json` by default. Set `REPOVISTA_CONFIG=/path/to/settings.json` to use a different settings file.

CLI flags always override saved settings for the current run.

## CI Notes

For CI/CD:

```sh
repovista audit --ci --json --fail-on-critical
```

Exit codes:

- `0`: Audit completed without a critical CI gate.
- `1`: At least one analysis phase failed or a fatal error occurred.
- `2`: `--ci --fail-on-critical` was set and the risk report contains critical findings.

Reports can be stored as CI artifacts from the selected `--out` directory.

## Typical Workflows

- Understand an unfamiliar repository: run `repovista`, then read `.repovista/<run-id>/index.md`.
- Configure persistent defaults: run `repovista settings`, choose a model with Space, return with Enter, then save.
- Keep technical logs for troubleshooting: `repovista audit --keep-logs`.
- Generate reports in a specific language: `repovista audit --language Spanish`.
- Ignore additional generated folders: `repovista audit --ignore "fixtures/generated/**"`.

## Troubleshooting

`Codex CLI was not found`
: Install and authenticate Codex separately. Then check `codex --version`.

`Codex CLI appears to be unauthenticated`
: Sign in to the Codex CLI and start the audit again.

`The current directory does not look like a code project`
: Run RepoVista from the project root. Recognized markers include `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `README.md`, `src/`, `lib/`, or `app/`.

`Sandbox mode rejected`
: Use `read-only` or, only by conscious choice, `workspace-write`. RepoVista is not intended for automatic code changes in the MVP.

Very large repositories
: RepoVista shortens the inventory and marks omitted entries. Codex can still read the repository itself, but receives compact orientation context.

## Development

```sh
npm install
npm run typecheck
npm test
```

The unit tests do not call Codex for real. The Codex runner is tested with mocked processes.
