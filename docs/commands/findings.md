# findings

List persisted or run-specific findings, emit JSON, or export findings.

## Usage

```sh
repovista findings [--run <run-id|dir>] [--status <status>] [--all] [--json] [--export <formats>]
```

## Options

| Option | Purpose |
| --- | --- |
| `--run <run-id|dir>` | Read findings from a specific run. |
| `--status <status>` | Filter by `open`, `fixed`, `false-positive`, `wont-fix`, or `uncertain`. |
| `--all` | Include all finding statuses. |
| `--json` | Emit JSON. |
| `--export <formats>` | Export `sarif`, `html`, `jsonl`, or `github`. |

## Examples

```sh
repovista findings
repovista findings --status open
repovista findings --all
repovista findings --json
repovista findings --run 2026-05-21T10-00-00-000Z
repovista findings --export sarif,github
```
