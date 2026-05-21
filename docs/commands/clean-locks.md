# clean-locks

Remove stale RepoVista feature locks.

## Usage

```sh
repovista clean-locks [--force]
```

## Options

- `--force` forces cleanup where supported.

## Examples

```sh
repovista clean-locks
repovista clean-locks --force
```

## Notes

Parallel and deep-review workflows use locks under `.repovista/locks/`.
