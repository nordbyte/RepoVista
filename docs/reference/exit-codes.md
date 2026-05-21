# Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed without a fatal or configured gate failure. |
| `1` | Command failed, usage was invalid, checks failed, a phase failed, or another non-gated error occurred. |
| `2` | A configured gate failed, such as critical findings, weak evidence, repository drift, quality threshold, or compare regression. |

## Common gate flags

```sh
repovista audit --ci --fail-on-critical
repovista audit --fail-on-weak-evidence
repovista audit --fail-on-drift
repovista audit --max-critical 0 --max-high 0
repovista compare .repovista/base .repovista/head --fail-on-regression
```
