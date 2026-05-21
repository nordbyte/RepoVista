# CI/CD

RepoVista can generate GitHub Actions workflows and can run in CI mode.

## Generate a workflow

```sh
repovista ci init --template pr-light --dry-run
repovista ci init --template security --force
repovista ci init --template release-readiness
repovista ci init --template scheduled-audit
```

Templates:

| Template | Use it for |
| --- | --- |
| `pr-light` | pull request checks with lighter scope |
| `security` | security-focused audits and exports |
| `release-readiness` | strict pre-release checks |
| `scheduled-audit` | recurring repository audits |

## CI flags

```sh
repovista audit --ci --json --fail-on-critical
repovista audit --ci --fail-on-weak-evidence
repovista audit --ci --max-critical 0 --max-high 0
```

`--ci` disables the interactive progress UI. Gate flags can return exit code `2` for configured finding thresholds or regressions.

## Compare gates

```sh
repovista compare .repovista/base .repovista/head --fail-on-regression
repovista compare .repovista/base .repovista/head --max-new-critical 0 --max-new-high 0
```

## Artifacts

Upload `.repovista/<run-id>/index.md`, `summary.json`, `findings.sarif`, `findings.jsonl`, and `report.html` as CI artifacts when you need both human review and machine processing.
