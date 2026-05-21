# pr-comment

Render or post a pull request summary comment for a RepoVista run.

## Usage

```sh
repovista pr-comment <run-dir> [--dry-run]
```

## Options

- `--dry-run` renders the comment without writing remotely.

## Examples

```sh
repovista pr-comment .repovista/2026-05-21T10-00-00-000Z --dry-run
repovista pr-comment .repovista/2026-05-21T10-00-00-000Z
```

## Requirements

Posting requires GitHub CLI authentication and a pull request context that RepoVista can resolve.
