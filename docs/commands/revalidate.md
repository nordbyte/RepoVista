# revalidate

Re-check finding evidence against the current checkout.

## Usage

```sh
repovista revalidate <finding-id|--all> [--provider-revalidate]
```

## Options

| Option | Purpose |
| --- | --- |
| `--all` | Revalidate all findings. |
| `--provider-revalidate` | Ask the configured provider for a read-only status decision. |
| `--since <git-ref>` | Focus local revalidation on changes since a ref where supported. |

## Examples

```sh
repovista revalidate fnd_abc123def456
repovista revalidate --all
repovista revalidate --all --since origin/main
repovista revalidate fnd_abc123def456 --provider-revalidate
```
