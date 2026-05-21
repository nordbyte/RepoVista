# baseline

Manage baseline suppressions for known findings.

## Usage

```sh
repovista baseline [list|add|remove|prune] [finding-id] [--note <text>]
```

## Subcommands

| Subcommand | Purpose |
| --- | --- |
| `list` | Show current baseline entries. This is the default. |
| `add <finding-id>` | Add a finding to the baseline. |
| `remove <finding-id>` | Remove a finding from the baseline. |
| `prune` | Remove stale baseline entries where supported. |

## Options

- `--note <text>` stores a baseline note.

## Examples

```sh
repovista baseline list
repovista baseline add fnd_abc123def456 --note "accepted risk"
repovista baseline remove fnd_abc123def456
repovista baseline prune
```
