# RepoVista documentation

RepoVista is a command line tool for structured, read-only AI repository audits. It collects local project evidence, runs specialized analysis phases through provider CLIs such as Codex CLI and Claude Code CLI, and writes Markdown plus machine-readable reports to `.repovista/<run-id>`.

<img class="repovista-home-image" src="/repovista-hero.png" alt="RepoVista report overview">

Install RepoVista with `npm install -g repovista`, authenticate one provider CLI, then run `repovista` from a repository root.

## Where to start

- [Install](start/install.md) - Node.js requirements, npm install, provider setup, and verification.
- [Quickstart](start/quickstart.md) - first audit, first report, and the commands most users run next.
- [Core concepts](start/core-concepts.md) - runs, evidence, phases, findings, state, and providers.
- [First audit](start/first-audit.md) - what happens during an audit and how to read the output.
- [Troubleshooting](start/troubleshooting.md) - provider, permissions, checks, and output issues.

## What RepoVista does

- [Configuration](guides/configuration.md) - persisted defaults, CLI overrides, profiles, and first-run behavior.
- [Providers](guides/providers.md) - Codex, Claude, Gemini, OpenCode, Aider, and provider plugins.
- [Reports and state](guides/reports.md) - generated files, terminal browser, HTML/SARIF/JSONL exports, and cache.
- [Findings](guides/findings.md) - lifecycle, triage, baselines, validation, and issue queues.
- [Publishing](guides/publishing.md) - explicit GitHub issue and pull request publishing from GitHub-source runs, plus linked remote status refreshes.
- [Fixes and patches](guides/fixes.md) - opt-in write workflow, scope gates, validation, rollback, and PR creation.

## Reference

- [Command reference](commands/index.md) - every current CLI command grouped by workflow.
- [Command docs](commands/audit.md) - one page per command with usage, options, and examples.
- [CLI options](reference/options.md) - every current flag and accepted value.
- [Settings keys](reference/settings.md) - persisted settings, types, defaults, and environment path override.
- [Output files](reference/output-files.md) - run directory layout and machine-readable artifacts.
- [Exit codes](reference/exit-codes.md) - command status and CI gate behavior.

## Surfaces

| Surface | Use it for | Entry point |
| --- | --- | --- |
| CLI | local audits, report browsing, finding triage, CI | `npm install -g repovista` |
| GitHub source audit | public repository audits without a local checkout | `repovista audit --github-repo owner/repo` |
| Terminal UIs | report browsing and finding management | `repovista reports`, `repovista findings-ui` |
| TypeScript API | embedding the audit runner or provider helpers | `import { runAudit } from "repovista"` |

## Get help

- File issues: [github.com/nordbyte/RepoVista/issues](https://github.com/nordbyte/RepoVista/issues)
- Source: [github.com/nordbyte/RepoVista](https://github.com/nordbyte/RepoVista)
- npm: [repovista](https://www.npmjs.com/package/repovista)
