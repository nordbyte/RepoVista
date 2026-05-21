# findings-ui

Open the interactive terminal UI for finding triage.

## Usage

```sh
repovista findings-ui
```

## What it shows

- persisted findings across runs
- status, severity, category, and evidence refs
- lifecycle history
- GitHub issue and PR links
- publish readiness
- workflow filters for open, critical/high, without issue, without PR, overdue, and publishable findings
- mixed issue and PR queues

## Related commands

```sh
repovista findings
repovista show fnd_abc123def456
repovista triage fnd_abc123def456 --status fixed
```
