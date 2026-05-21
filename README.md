# RepoVista

![RepoVista Banner](docs/repovista.png)

[![Latest release](https://img.shields.io/github/v/release/nordbyte/RepoVista?style=flat-square)](https://github.com/nordbyte/RepoVista/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/nordbyte/RepoVista/ci.yml?branch=main&style=flat-square)](https://github.com/nordbyte/RepoVista/actions/workflows/ci.yml) [![Security](https://img.shields.io/github/actions/workflow/status/nordbyte/RepoVista/security.yml?branch=main&label=security&style=flat-square)](https://github.com/nordbyte/RepoVista/actions/workflows/security.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-ffd60a?style=flat-square)](LICENSE) [![npm](https://img.shields.io/npm/v/repovista?logo=npm&logoColor=white&style=flat-square)](https://www.npmjs.com/package/repovista) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white&style=flat-square)](package.json) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white&style=flat-square)](tsconfig.json)

RepoVista is a CLI for structured, read-only AI repository audits. It collects local project evidence, runs specialized analysis phases through provider CLIs such as Codex CLI or Claude Code CLI, and writes Markdown plus machine-readable reports to `.repovista/<run-id>`.

## Install

```sh
npm install -g repovista
```

Requirements:

- Node.js 20 or newer.
- At least one installed and authenticated provider CLI, for example `codex` or `claude`.
- Permission to analyze the repository with the selected provider.

## Quick Start

Run from a repository root:

```sh
repovista
```

Useful first commands:

```sh
repovista settings
repovista doctor
repovista plan
repovista audit
repovista reports
repovista findings-ui
```

The main report entry point is written to:

```text
.repovista/<run-id>/index.md
```

Use `repovista reports` to open the terminal report browser, select a generated run, search inside one section or across runs, filter/sort findings, open finding details with evidence previews, triage statuses, compare with the previous run, bookmark sections/findings, queue GitHub issues or PRs for selected findings, export the current view, and navigate the full report or individual sections. Use `repovista findings-ui` for the same persistent finding management view across runs, including publish readiness, workflow filters, and mixed issue/PR queues.

During an interactive audit, RepoVista shows a live progress TUI with the current step and elapsed counters. Press `q` or `Ctrl+C` to cancel; RepoVista sends `SIGINT` to the provider process group so the provider can cancel cleanly, then escalates to `SIGTERM` and `SIGKILL` if it does not exit.

Fresh installs use quality-oriented defaults: Codex CLI, `reasoning=xhigh`, read-only sandbox, local checks, strict report gates, report repair, incremental cache, `parallel=auto`, and SARIF/HTML/JSONL exports.

## Common Examples

```sh
repovista audit --model gpt-5.5
repovista audit --provider claude --model sonnet --reasoning high
repovista audit --github-repo nordbyte/RepoVista
repovista audit --github-repo https://github.com/nordbyte/RepoVista --github-ref v0.4.0
repovista audit --no-parallel
repovista audit --since origin/main
repovista audit --ci --json --fail-on-critical
repovista compare .repovista/old-run .repovista/new-run
repovista findings
repovista findings-ui
repovista next
repovista publish fnd_abc123def456 --run .repovista/run-id --as issue --dry-run
repovista publish fnd_abc123def456 --run .repovista/run-id --as issue --publish-language German
repovista publish fnd_abc123def456 --run .repovista/run-id --as pr --contribution-policy warn
repovista fix fnd_abc123def456 --dry-run
repovista ci init --template security --dry-run
```

GitHub issues and pull request descriptions published from findings default to English, even when the report was generated in another language. Use `--publish-language <name>` to publish them in a different language.
For `--github-repo` reports, `repovista publish` also reads repository contribution guidelines, security policy, and issue/PR templates from the analyzed checkout. The default `--contribution-policy enforce` blocks public security disclosures and guideline conflicts; use `warn` to allow publishing with visible warnings or `off` to skip guideline handling.

## Documentation

Full documentation is published at [repovista.com](https://repovista.com/) and lives in [docs/](docs/index.md).

- [Quickstart](docs/start/quickstart.md)
- [CLI Command Reference](docs/commands/index.md)
- [CLI Options](docs/reference/options.md)
- [Configuration](docs/guides/configuration.md)
- [Providers](docs/guides/providers.md)
- [Reports and State](docs/guides/reports.md)
- [Finding and Fix Workflows](docs/guides/findings.md)
- [CI/CD](docs/guides/ci.md)
- [Architecture](docs/internals/architecture.md)
- [Security Model](docs/internals/security.md)

## Notes

RepoVista is an audit and review assistant. It is not a replacement for tests, manual review, SAST, dependency scanning, or a security assessment. By default, provider runs use read-only intent. The opt-in `repovista fix` workflow can write changes, records patch attempts, and never commits or pushes by itself. The separate `repovista publish --as pr` workflow is explicit GitHub publishing for `--github-repo` reports and can create commits, push a branch or fork, and open a PR after confirmation.
