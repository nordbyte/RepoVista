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
```

The main report entry point is written to:

```text
.repovista/<run-id>/index.md
```

Use `repovista reports` to open the terminal report browser, select a generated run, and navigate the full report or individual sections.

During an interactive audit, RepoVista shows a live progress TUI with the current step and elapsed counters. Press `q` or `Ctrl+C` to cancel; RepoVista sends `SIGINT` to the provider process group so the provider can cancel cleanly, then escalates to `SIGTERM` and `SIGKILL` if it does not exit.

Fresh installs use quality-oriented defaults: Codex CLI, `reasoning=xhigh`, read-only sandbox, local checks, strict report gates, report repair, incremental cache, `parallel=auto`, and SARIF/HTML/JSONL exports.

## Common Examples

```sh
repovista audit --model gpt-5.5
repovista audit --provider claude --model sonnet --reasoning high
repovista audit --no-parallel
repovista audit --since origin/main
repovista audit --ci --json --fail-on-critical
repovista compare .repovista/old-run .repovista/new-run
repovista findings
repovista next
repovista fix fnd_abc123def456 --dry-run
repovista ci init --template security --dry-run
```

## Documentation

Full documentation lives in [docs/](docs/README.md):

- [Getting Started](docs/getting-started.md)
- [CLI Reference](docs/cli-reference.md)
- [Configuration and Settings](docs/configuration.md)
- [Reports and State](docs/reports-and-state.md)
- [Providers and Plugins](docs/providers.md)
- [Finding and Fix Workflows](docs/workflows.md)
- [CI/CD](docs/ci.md)
- [Architecture](docs/architecture.md)
- [Security Model](docs/security.md)
- [API Reference](docs/api-reference.md)
- [Development](docs/development.md)

## Notes

RepoVista is an audit and review assistant. It is not a replacement for tests, manual review, SAST, dependency scanning, or a security assessment. By default, provider runs use read-only intent. The opt-in `repovista fix` workflow can write changes, records patch attempts, and never commits or pushes by itself.
