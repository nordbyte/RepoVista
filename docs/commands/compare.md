# compare

Compare two RepoVista run directories.

## Usage

```sh
repovista compare <old-run-dir> <new-run-dir> [--format markdown|json|html] [--fail-on-regression]
```

## Options

| Option | Purpose |
| --- | --- |
| `--format <format>` | Output `markdown`, `json`, or `html`. |
| `--json` | Alias for `--format json` for this command. |
| `--fail-on-regression` | Exit `2` when new critical or high findings are detected. |
| `--max-new-critical <n>` | Exit `2` when new critical findings exceed the threshold. |
| `--max-new-high <n>` | Exit `2` when new high findings exceed the threshold. |
| `--max-new-medium <n>` | Exit `2` when new medium findings exceed the threshold. |

## Examples

```sh
repovista compare .repovista/base .repovista/head
repovista compare .repovista/base .repovista/head --format json
repovista compare .repovista/base .repovista/head --fail-on-regression
repovista compare .repovista/base .repovista/head --max-new-critical 0 --max-new-high 0
```

## Exit behavior

Compare returns exit code `2` for configured regression gates and `1` for usage or runtime failures.
