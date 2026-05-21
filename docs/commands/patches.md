# patches

List or preview RepoVista patch attempts.

## Usage

```sh
repovista patches [patch-id] [--json] [--dry-run]
```

## Options

| Option | Purpose |
| --- | --- |
| `--json` | Emit patch attempt data as JSON. |
| `--dry-run` | Preview patch details without applying anything. |

## Examples

```sh
repovista patches
repovista patches pat_abc123def456
repovista patches pat_abc123def456 --json
repovista patches pat_abc123def456 --dry-run
```
