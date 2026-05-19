# RepoVista Documentation

RepoVista runs structured AI repository audits through local provider CLIs and stores both human-readable and machine-readable output under `.repovista/`.

## Documentation Map

- [Getting Started](getting-started.md): installation, first audit, report location, and troubleshooting.
- [CLI Reference](cli-reference.md): command and option reference.
- [Configuration and Settings](configuration.md): interactive settings, non-interactive settings, profiles, workspaces, and incremental mode.
- [Reports and State](reports-and-state.md): generated files, persistent state, cache, quality gates, evidence, and comparison outputs.
- [Providers and Plugins](providers.md): built-in providers, provider behavior, plugin format, and trust controls.
- [Finding and Fix Workflows](workflows.md): findings, triage, baseline, revalidation, issues, patches, and fixes.
- [CI/CD](ci.md): GitHub Actions templates, CI flags, artifacts, and exit codes.
- [Architecture](architecture.md): runtime flow and module responsibilities.
- [Security Model](security.md): sandbox intent, provider trust, secrets, checks, and write paths.
- [API Reference](api-reference.md): public TypeScript exports.
- [Development](development.md): local setup, tests, packaging, and release notes.

## Core Concepts

- **Run directory**: one timestamped audit output directory under `.repovista/`.
- **Evidence pack**: local facts collected before provider phases, including runtime, Git, package metadata, provider version, and optional checks.
- **Provider**: a local CLI adapter such as Codex CLI, Claude Code CLI, Gemini CLI, OpenCode CLI, Aider CLI, or a JSON plugin.
- **Phase**: one analysis pass such as architecture, code quality, risk and bugs, feature roadmap, or summary.
- **Finding**: a structured risk item with stable id, severity, paths, evidence, recommendation, lifecycle status, and validation state.
- **Project map**: a persisted repository map used for planning parallel audits and feature-sliced deep review.
- **State layer**: versioned storage for findings, features, cache, patches, and baseline suppressions.

## Recommended Reading Order

1. [Getting Started](getting-started.md)
2. [Configuration and Settings](configuration.md)
3. [Reports and State](reports-and-state.md)
4. [Finding and Fix Workflows](workflows.md)
5. [CLI Reference](cli-reference.md)
6. [API Reference](api-reference.md)
