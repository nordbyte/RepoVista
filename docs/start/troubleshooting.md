# Troubleshooting

## Provider not found

Check available providers and executable diagnostics:

```sh
repovista providers list --json
repovista providers test codex
repovista doctor --json
```

Install or authenticate the selected provider CLI, then rerun `doctor`.

## Report is empty or weak

Use strict reports and repair attempts:

```sh
repovista audit --strict-reports --repair-reports --repair-attempts 2
```

Add focused guidance with:

```sh
repovista audit --prompt-file ./repovista-guidance.md
```

## Local checks fail

RepoVista runs detected or explicit checks before analysis when `--run-checks` is enabled. Disable checks only when the failure is unrelated to the audit:

```sh
repovista audit --no-run-checks
```

or add explicit checks:

```sh
repovista audit --check "npm test" --check-timeout 10
```

## Parallel mode feels wrong

Preview the plan:

```sh
repovista plan
```

Then choose a fixed budget or disable parallel work:

```sh
repovista audit --parallel 2
repovista audit --no-parallel
```

## Repository drift

Use a detached snapshot for analysis:

```sh
repovista audit --snapshot
```

Fail the command if drift is detected:

```sh
repovista audit --fail-on-drift
```

## GitHub publishing fails

Publishing uses `gh`. Verify authentication and dry-run first:

```sh
gh auth status
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --dry-run
```
