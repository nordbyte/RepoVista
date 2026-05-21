# Output files

A run directory is created below `.repovista/` by default.

## Typical run layout

Full audits include all phase Markdown files below. `--bug-findings` runs include `00-inventory.md`, `03-risk-and-bug-report.md`, and the supporting JSON/state/export artifacts, but intentionally skip the other phase Markdown reports.

| File | Purpose |
| --- | --- |
| `index.md` | Combined human-readable report. |
| `00-inventory.md` | Repository inventory and evidence overview. |
| `01-architecture-report.md` | Architecture phase report. |
| `02-code-quality-report.md` | Code quality phase report. |
| `03-risk-and-bug-report.md` | Risk and bug phase report. |
| `04-feature-roadmap.md` | Feature roadmap phase report. |
| `*.structured.json` | Provider-native structured outputs for repair and review. |
| `summary.json` | Run summary, phase status, and aggregate metrics. |
| `meta.json` | Run metadata, source repository, options, and environment facts. |
| `findings.json` | Structured findings for the run, including linked GitHub issue and PR status when refreshed. |
| `findings.jsonl` | Line-delimited finding export. |
| `findings.sarif` | SARIF export for code scanning tools. |
| `report.html` | Standalone HTML dashboard. |
| `report.json` | Dashboard data payload. |
| `prompt-manifest.json` | Prompt inputs and evidence references. |

## Persistent state

| Path | Purpose |
| --- | --- |
| `.repovista/findings/` | Cross-run finding state, lifecycle history, and linked GitHub issue/PR status. |
| `.repovista/features/` | Feature state and lock metadata. |
| `.repovista/cache/` | Scan cache and fingerprints. |
| `.repovista/patches/` | Patch attempt metadata, diffs, and summaries. |
| `.repovista/project-map.json` | Project map for planning, parallel work, and feature review. |

## Logs

Technical provider logs are stored only when `--keep-logs` or matching settings are enabled.
