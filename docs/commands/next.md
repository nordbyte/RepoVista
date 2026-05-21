# next

Show the next prioritized finding from persistent finding state.

## Usage

```sh
repovista next [--status <status>]
```

## Options

- `--status <status>` filters by `open`, `fixed`, `false-positive`, `wont-fix`, or `uncertain`.

## Examples

```sh
repovista next
repovista next --status open
repovista next --status uncertain
```

## Related

Use `repovista show <finding-id>` for details and `repovista triage` to update status.
