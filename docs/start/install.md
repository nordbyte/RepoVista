# Install RepoVista

RepoVista is distributed as an npm package and runs on Node.js 20 or newer. It delegates analysis to local provider CLIs, so install and authenticate at least one provider before running a real audit.

## npm

```sh
npm install -g repovista
repovista version
repovista doctor
```

Update with:

```sh
npm update -g repovista
```

## Requirements

- Node.js 20 or newer.
- A Git checkout or a public GitHub repository selected with `--github-repo`.
- At least one authenticated provider CLI such as `codex`, `claude`, `gemini`, `opencode`, or `aider`.
- Permission to send repository context to the selected provider.

## Provider setup

Codex is the default provider:

```sh
repovista providers list
repovista providers test codex
```

Use another provider by flag or saved setting:

```sh
repovista audit --provider claude
repovista settings set provider claude
```

Provider-specific behavior is documented in [Providers](../guides/providers.md).

## Verify

Run these from a repository root:

```sh
repovista version
repovista doctor
repovista plan
```

`doctor` checks provider executables, plugin trust, Git state, output paths, workspaces, settings, and report-output readiness.
