# publish

Publish selected findings from a GitHub-source run as GitHub issues or pull requests.

## Usage

```sh
repovista publish <finding-id|--all> --run <run-id|dir> --as issue|pr [--dry-run] [--fork] [--publish-language <name>] [--contribution-policy enforce|warn|off]
```

## Options

| Option | Purpose |
| --- | --- |
| `--run <run-id|dir>` | Required. Select the GitHub-source run. |
| `--as <issue|pr>` | Required. Publish target. |
| `--dry-run` | Preview without remote writes. |
| `--fork` | Force fork-based PR publishing. |
| `--publish-language <name>` | Language for published issue or PR text. |
| `--contribution-policy <mode>` | `enforce`, `warn`, or `off`. |
| `--label <name>` | Add issue label. Repeatable. |
| `--assignee <login>` | Assign issue. Repeatable. |
| `--owner-rule <glob=owner>` | Assign finding owner by affected path. Repeatable. |
| `--label-rule <glob=label>` | Add label by affected path. Repeatable. |
| `--sla-days <n>` | Set default finding SLA in days. |
| `--all` | Publish all selected findings. |

## Examples

```sh
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --dry-run
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --publish-language German
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as pr --dry-run
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as pr --fork
```

## Requirements

The source run must have been created with `--github-repo`, and `gh` must be authenticated.

After publishing, use [`repovista github-status`](github-status.md) or press `g`/`G` in the TUIs to refresh whether linked issues are open or closed and whether linked pull requests are open, closed, draft, or merged.
