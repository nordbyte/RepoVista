# open-pr

Create a pull request for a completed patch attempt.

## Usage

```sh
repovista open-pr <patch-id> [--dry-run] [--base <branch>] [--branch <branch>] [--title <title>]
```

## Options

| Option | Purpose |
| --- | --- |
| `--dry-run` | Preview the PR command and content. |
| `--base <branch>` | Base branch for the PR. |
| `--branch <branch>` | Branch name to use. |
| `--title <title>` | Pull request title. |

## Examples

```sh
repovista open-pr pat_abc123def456 --dry-run
repovista open-pr pat_abc123def456 --base main --branch repovista/fix-abc --title "Fix RepoVista finding"
```

## Requirements

This command uses Git and the GitHub CLI.
