# CI/CD

## Generate GitHub Actions Workflows

```sh
repovista ci init
repovista ci init --dry-run
repovista ci init --force
```

Available templates:

```sh
repovista ci init --template pr-light
repovista ci init --template security
repovista ci init --template release-readiness
repovista ci init --template scheduled-audit
```

## Templates

| Template | Purpose |
|---|---|
| `pr-light` | Lightweight pull request audit with artifacts. |
| `security` | Security-focused strict audit with checks, SARIF, HTML, JSONL, and GitHub annotation exports. |
| `release-readiness` | Strict pre-release audit for tags or manual runs. |
| `scheduled-audit` | Scheduled security audit with incremental metadata. |

## Recommended CI Command

```sh
repovista audit --ci --json --fail-on-critical --run-checks --strict-reports
```

Common additions:

```sh
repovista audit --export sarif,html,jsonl,github
repovista audit --audit-profile security
repovista audit --audit-profile release-readiness
repovista audit --since origin/main
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Audit completed without configured CI failure. |
| `1` | Fatal command failure, failed phase, or failed local checks in CI. |
| `2` | Critical findings or compare regressions triggered a configured fail condition. |

## Artifacts

Store the selected `--out` directory as a workflow artifact. The default is `.repovista/`.

Useful files for CI:

- `.repovista/<run-id>/index.md`
- `.repovista/<run-id>/summary.json`
- `.repovista/<run-id>/report.json`
- `.repovista/<run-id>/findings.sarif`
- `.repovista/<run-id>/github-annotations.json`
- `.repovista/<run-id>/report.html`

## Pull Request Comments

```sh
repovista pr-comment .repovista/<run-id> --dry-run
repovista pr-comment .repovista/<run-id>
```

Without `--dry-run`, the command uses `gh pr comment`.

## Compare in CI

```sh
repovista compare .repovista/previous .repovista/current --fail-on-regression
```

Use `--format json` for machine-readable output or `--format html` for an artifact.
