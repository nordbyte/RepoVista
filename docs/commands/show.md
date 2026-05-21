# show

Show one persisted finding with evidence and lifecycle history.

## Usage

```sh
repovista show <finding-id>
```

You can also pass the finding with `--finding`:

```sh
repovista show --finding fnd_abc123def456
```

## Examples

```sh
repovista show fnd_abc123def456
```

## Related

```sh
repovista triage fnd_abc123def456 --status fixed --note "validated"
repovista revalidate fnd_abc123def456
```
