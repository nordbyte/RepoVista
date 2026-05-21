# providers

List loaded providers or test one provider executable.

## Usage

```sh
repovista providers [list|test <provider>] [--json]
```

## Subcommands

| Subcommand | Purpose |
| --- | --- |
| `list` | List built-in and plugin providers. This is the default. |
| `test <provider>` | Check one provider executable and version command. |

## Options

- `--json` emits provider diagnostics as JSON.
- `--allow-repo-provider-plugin` permits execution of repository-local provider plugins.

## Examples

```sh
repovista providers
repovista providers list --json
repovista providers test codex
repovista providers test claude
```

## Built-in providers

`codex`, `claude`, `gemini`, `opencode`, and `aider` are built in. Plugins can add more providers.
