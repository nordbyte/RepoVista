# Getting Started

## Requirements

- Node.js 20 or newer.
- One installed and authenticated provider CLI:
  - Codex CLI with `codex` available in `PATH`, or
  - Claude Code CLI with `claude` available in `PATH`, or
  - another supported provider or trusted plugin.
- Permission and privacy clearance for the repository being analyzed.

RepoVista does not install provider CLIs automatically and does not enable telemetry.

## Installation

Install from npm:

```sh
npm install -g repovista
```

GitHub Packages releases are also available as `@nordbyte/repovista`:

```sh
npm config set @nordbyte:registry https://npm.pkg.github.com
npm install -g @nordbyte/repovista
```

## First Audit

Run from the repository root:

```sh
repovista
```

The explicit form is equivalent:

```sh
repovista audit
```

RepoVista writes reports to `.repovista/<run-id>/`. Start with:

```text
.repovista/<run-id>/index.md
```

Or browse generated runs and sections in the terminal:

```sh
repovista reports
```

Interactive audits show a live progress TUI with the current step and elapsed counters. After a successful interactive audit, RepoVista opens the same report browser used by `repovista reports` with the new run selected so you can open the full report or individual sections immediately. Press `q` or `Ctrl+C` to cancel while the audit is running. RepoVista cancels the audit, sends `SIGINT` to the running provider process group so Codex/Claude can cancel cleanly, then escalates to `SIGTERM` and `SIGKILL` if the provider does not exit.

Fresh installs are ready for a high-signal first audit. The built-in defaults use Codex CLI, `reasoning=xhigh`, read-only sandboxing, local checks, strict report gates, one repair attempt, incremental cache metadata, `parallel=auto`, and SARIF/HTML/JSONL exports.

## Recommended First Setup

```sh
repovista doctor
repovista settings
repovista plan
```

- `doctor` checks the current project, output path, provider executable, plugin diagnostics, Git state, settings, and workspaces.
- `settings` opens the interactive default-settings menu.
- `plan` shows whether parallel mode is useful for the current repository.

## Higher-Signal Audit

```sh
repovista audit
```

This already collects local check results, applies strict report quality gates, lets the provider repair reports that miss required depth, and writes the default exports. Use `--no-run-checks`, `--no-strict-reports`, `--no-repair-reports`, or `--no-parallel` only when a repository needs a lighter run.

## Provider Examples

```sh
repovista audit --provider codex --model gpt-5.5
repovista audit --provider claude --model sonnet --reasoning high
repovista audit --provider gemini --model gemini-2.5-pro
repovista audit --provider opencode --model anthropic/claude-sonnet-4-5
repovista audit --provider aider --model sonnet
```

## Common Follow-Up Commands

```sh
repovista compare .repovista/old-run .repovista/new-run
repovista reports
repovista findings
repovista next
repovista show fnd_abc123def456
repovista triage fnd_abc123def456 --status fixed --note "validated"
repovista baseline add fnd_abc123def456 --note "accepted risk"
repovista fix fnd_abc123def456 --dry-run
```

## Troubleshooting

`Codex CLI was not found`
: Install and authenticate Codex separately, then verify `codex --version`.

`Claude Code CLI was not found`
: Install and authenticate Claude Code separately, then verify `claude --version`.

`The current directory does not look like a code project`
: Run RepoVista from a project root. Recognized markers include `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `README.md`, `src/`, `lib/`, and `app/`.

`Sandbox mode rejected`
: Use `read-only` for audits. Use `workspace-write` only for explicit fix workflows.

Large repositories
: Inspect `repovista plan`. The first `parallel=auto` audit creates `.repovista/project-map.json` automatically when it is missing.
