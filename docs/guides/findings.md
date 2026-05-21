# Findings

Findings are persisted risk records with stable ids such as `fnd_abc123def456`.

## List and inspect

```sh
repovista findings
repovista findings --json
repovista findings --run 2026-05-21T10-00-00-000Z
repovista next
repovista show fnd_abc123def456
```

## Lifecycle statuses

Supported statuses are:

- `open`
- `fixed`
- `false-positive`
- `wont-fix`
- `uncertain`

Update one finding:

```sh
repovista triage fnd_abc123def456 --status fixed --note "validated"
```

Update all selected findings:

```sh
repovista triage --all --status uncertain --note "needs review"
```

## Revalidation

Local revalidation checks evidence against the current checkout:

```sh
repovista revalidate fnd_abc123def456
repovista revalidate --all
repovista revalidate --all --since origin/main
```

Provider revalidation asks the configured provider for a read-only decision:

```sh
repovista revalidate fnd_abc123def456 --provider-revalidate
```

## Baseline

Use baselines for accepted risks and known false positives:

```sh
repovista baseline list
repovista baseline add fnd_abc123def456 --note "accepted risk"
repovista baseline remove fnd_abc123def456
repovista baseline prune
repovista suppress fnd_abc123def456 --note "accepted risk"
```

## Finding UI

```sh
repovista findings-ui
```

The TUI shows publish readiness, linked issue and PR remote status, evidence refs, workflow filters, and mixed publish queues. Press `g` to refresh the selected finding's GitHub issue or PR status, or `G` to refresh all visible findings.
