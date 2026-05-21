# rollback

Reverse a recorded RepoVista patch diff.

## Usage

```sh
repovista rollback <patch-id> [--dry-run]
```

## Options

- `--dry-run` previews the rollback.

## Examples

```sh
repovista rollback pat_abc123def456 --dry-run
repovista rollback pat_abc123def456
```

## Notes

Rollback uses the recorded patch diff and applies it in reverse with `git apply -R`.
