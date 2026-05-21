# review

Review one RepoVista run for report quality, evidence, and stale state risks.

## Usage

```sh
repovista review <run-dir> [--json]
```

## Options

- `--json` emits machine-readable review output.

## Examples

```sh
repovista review .repovista/2026-05-21T10-00-00-000Z
repovista review .repovista/2026-05-21T10-00-00-000Z --json
```

## When to use it

Use `review` after a run has been created when you want to evaluate evidence quality, stale checkout signals, report completeness, and machine-readable artifact health.
