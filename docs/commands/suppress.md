# suppress

Shortcut for adding a finding to the baseline.

## Usage

```sh
repovista suppress <finding-id> [--note <text>]
```

## Options

- `--note <text>` stores a suppression note.

## Examples

```sh
repovista suppress fnd_abc123def456 --note "accepted risk"
```

## Equivalent command

```sh
repovista baseline add fnd_abc123def456 --note "accepted risk"
```
