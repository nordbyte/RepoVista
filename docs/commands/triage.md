# triage

Update the lifecycle status of one finding or all selected findings.

## Usage

```sh
repovista triage <finding-id|--all> --status <status> [--note <text>]
```

## Options

| Option | Purpose |
| --- | --- |
| `--status <status>` | Required. `open`, `fixed`, `false-positive`, `wont-fix`, or `uncertain`. |
| `--note <text>` | Store a lifecycle note. |
| `--all` | Update all selected findings. |

## Examples

```sh
repovista triage fnd_abc123def456 --status fixed --note "validated"
repovista triage --all --status uncertain --note "needs review"
```
