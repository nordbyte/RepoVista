# repair-run

Rebuild run artifacts from provider-native `.structured.json` outputs.

## Usage

```sh
repovista repair-run <run-dir> [--force] [--json]
```

## Options

| Option | Purpose |
| --- | --- |
| `--force` | Rebuild even when existing artifacts are present. |
| `--json` | Emit machine-readable repair output. |

## Examples

```sh
repovista repair-run .repovista/2026-05-21T10-00-00-000Z
repovista repair-run .repovista/2026-05-21T10-00-00-000Z --force --json
```

## Notes

This command is for run recovery and artifact regeneration. It does not rerun the provider analysis itself.
