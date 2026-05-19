# Providers and Plugins

## Built-In Providers

RepoVista currently includes provider adapters for:

- Codex CLI (`codex`)
- Claude Code CLI (`claude`)
- Gemini CLI (`gemini`)
- OpenCode CLI (`opencode`)
- Aider CLI (`aider`)

List providers:

```sh
repovista providers list
repovista providers list --json
```

Test one provider:

```sh
repovista providers test codex
```

## Codex CLI

Codex is the default provider. RepoVista uses non-interactive, read-only intent for audits:

- `--cd <project-root>`
- `--config approval_policy="never"`
- `--sandbox read-only` by default
- `--skip-git-repo-check`
- `--ephemeral` so audit sessions are not persisted for later resume
- `--output-last-message <report.md>`
- `--output-schema <schema.json>` for phases with provider-native structured output
- `--config model_reasoning_effort="<effort>"` when reasoning is configured
- `--config service_tier="fast"` when fast mode is enabled

Use:

```sh
repovista audit --provider codex --model gpt-5.5 --reasoning xhigh
```

## Claude Code CLI

Claude Code uses print mode and writes final stdout to the phase report:

- `--print`
- `--output-format text`
- `--input-format text`
- `--no-session-persistence`
- `--permission-mode plan` for read-only intent
- `--permission-mode default` for workspace-write intent
- `--add-dir <project-root>`
- `--model <model>` when configured
- `--effort <effort>` when configured

Use:

```sh
repovista audit --provider claude --model sonnet --reasoning high
```

## Provider Capabilities

Provider adapters expose capabilities:

| Capability | Meaning |
|---|---|
| `readOnlySandbox` | Adapter supports read-only sandbox intent. |
| `workspaceWrite` | Adapter supports write mode for `repovista fix`. |
| `outputSchema` | Adapter can receive provider-native output schemas. |
| `jsonEvents` | Adapter can emit JSON event streams. |
| `promptFile` | Adapter supports prompt files instead of stdin-only prompts. |

Inspect capabilities with:

```sh
repovista providers list --json
```

## Plugin Providers

Plugins can be registered through:

- `REPOVISTA_PROVIDER_PLUGIN=/path/provider.json`
- `REPOVISTA_PROVIDER_PLUGINS=/path/a.json:/path/b.json`
- repository-local `repovista.providers.json`

Example:

```json
{
  "id": "example",
  "displayName": "Example Provider",
  "executable": "example-ai",
  "outputMode": "stdout",
  "versionArgs": ["--version"],
  "capabilities": {
    "readOnlySandbox": true,
    "workspaceWrite": false,
    "outputSchema": false,
    "jsonEvents": false,
    "promptFile": false
  },
  "args": ["run", "--cwd", "{projectRoot}", "--model", "{model}"]
}
```

`outputMode` can be:

- `stdout`: provider prints the final report to stdout.
- `report-file`: provider writes the report to `{reportPath}`.

Supported argument templates:

- `{projectRoot}`
- `{reportPath}`
- `{phaseId}`
- `{phaseTitle}`
- `{model}`
- `{profile}`
- `{reasoning}`
- `{sandbox}`
- `{jsonEvents}`
- `{fastMode}`

## Plugin Trust

Repository-local provider plugins are powerful because they can define arbitrary executables. RepoVista loads them for discovery, but audit, preflight, and provider tests will not execute them unless one of these is true:

```sh
repovista audit --provider custom --allow-repo-provider-plugin
```

or:

```sh
REPOVISTA_TRUSTED_PROVIDER_PLUGIN_DIRS=/trusted/plugins repovista audit --provider custom
```

Use `repovista doctor --json` or `repovista providers list --json` to inspect plugin diagnostics.

Provider definitions are loaded through the active provider registry for the current project root. That keeps repository-local plugins scoped to the repository being audited or inspected, and lets programmatic callers refresh providers explicitly before running preflight, doctor, or provider tests.
