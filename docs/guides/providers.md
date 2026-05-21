# Providers

RepoVista delegates analysis to local provider CLIs. The built-in providers are:

- `codex`
- `claude`
- `gemini`
- `opencode`
- `aider`

## List and test providers

```sh
repovista providers list
repovista providers list --json
repovista providers test codex
```

## Codex CLI

Codex is the default provider. RepoVista invokes it with read-only audit intent by default:

- `--cd <project-root>`
- `--config approval_policy="never"`
- `--sandbox read-only`
- `--skip-git-repo-check`
- `--ephemeral`
- `--output-last-message <report.md>`
- `--output-schema <schema.json>` where structured output is supported
- `--config model_reasoning_effort="<effort>"` when reasoning is configured
- `--config service_tier="fast"` when fast mode is enabled

Example:

```sh
repovista audit --provider codex --model gpt-5.5 --reasoning xhigh
```

## Claude Code CLI

Claude Code uses print mode and writes final output to the phase report:

- `--print`
- `--output-format text`
- `--input-format text`
- `--no-session-persistence`
- `--permission-mode plan` for read-only intent
- `--permission-mode default` for workspace-write intent
- `--add-dir <project-root>`
- `--model <model>` when configured
- `--effort <effort>` when configured

Example:

```sh
repovista audit --provider claude --model sonnet --reasoning high
```

## Capabilities

Provider adapters expose capabilities such as read-only sandbox support, workspace-write support, provider-native structured output, JSON events, and prompt-file support.

Inspect them with:

```sh
repovista providers list --json
```

## Provider plugins

Provider plugins are documented in [Provider plugins](../reference/settings.md#provider-plugin-trust) and [Security model](../internals/security.md#provider-plugin-trust).
