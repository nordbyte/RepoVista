# issue

Create, update, or sync GitHub issues for findings through the GitHub CLI.

## Usage

```sh
repovista issue <finding-id|--all> [--dry-run] [--label <name>] [--assignee <login>] [--update-existing] [--sync-issues]
```

## Options

| Option | Purpose |
| --- | --- |
| `--dry-run` | Preview issue content without writing remotely. |
| `--label <name>` | Add a GitHub issue label. Repeatable. |
| `--assignee <login>` | Assign the issue. Repeatable. |
| `--update-existing` | Update an existing matching issue instead of creating a duplicate. |
| `--sync-issues` | Create, update, and persist issue links for selected findings. |
| `--reopen-issues` | Reopen linked GitHub issues when findings reappear as open. |
| `--all` | Apply to all selected findings. |

## Examples

```sh
repovista issue fnd_abc123def456 --dry-run
repovista issue fnd_abc123def456 --label repovista --assignee octocat
repovista issue fnd_abc123def456 --update-existing
repovista issue --all --sync-issues --update-existing --reopen-issues
```

## Requirements

`issue` uses `gh` and requires GitHub CLI authentication.
