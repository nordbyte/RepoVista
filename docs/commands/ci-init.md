# ci init

Create a GitHub Actions workflow for RepoVista.

## Usage

```sh
repovista ci init [--template pr-light|security|release-readiness|scheduled-audit] [--dry-run] [--force]
```

## Options

| Option | Purpose |
| --- | --- |
| `--template <name>` | Choose `pr-light`, `security`, `release-readiness`, or `scheduled-audit`. |
| `--dry-run` | Preview generated workflow content. |
| `--force` | Overwrite generated files where supported. |

## Examples

```sh
repovista ci init --template pr-light --dry-run
repovista ci init --template security
repovista ci init --template release-readiness --force
```

## Related

See [CI/CD](../guides/ci.md) for CI gates and recommended artifacts.
