# audit

Run a full repository audit. `repovista` with no command is an alias for `repovista audit`.

## Usage

```sh
repovista [options]
repovista audit [options]
```

## Common options

- Source and scope: `--github-repo`, `--github-ref`, `--since`, `--pr`, `--base`, `--workspace`, `--all-workspaces`, `--workspace-matrix`
- Provider: `--provider`, `--model`, `--profile`, `--reasoning`, `--fast`, `--sandbox`
- Mode: `--audit-profile`, `--review-mode`, `--bug-findings`
- Quality: `--run-checks`, `--check`, `--strict-reports`, `--repair-reports`, `--repair-attempts`, `--deep-review`
- Output: `--out`, `--resume`, `--export`, `--json`, `--keep-logs`
- CI gates: `--ci`, `--fail-on-critical`, `--fail-on-drift`, `--fail-on-weak-evidence`, `--min-quality-score`, `--max-critical`, `--max-high`, `--max-medium`

See [CLI options](../reference/options.md) for every flag and accepted value.

## Examples

```sh
repovista audit
repovista audit --model gpt-5.5
repovista audit --provider claude --model sonnet --reasoning high
repovista audit --github-repo nordbyte/RepoVista
repovista audit --github-repo https://github.com/nordbyte/RepoVista --github-ref v0.4.0
repovista audit --bug-findings
repovista audit --github-repo nordbyte/RepoVista --bug-findings
repovista audit --since origin/main
repovista audit --ci --json --fail-on-critical
repovista audit --phase risk-and-bug --phase summary
```

## Output

The default output root is `.repovista`. Each run gets a timestamped directory with `index.md`, phase reports, JSON summaries, exports, findings, and metadata.

With `--bug-findings`, RepoVista writes the Risk/Bug report and the supporting JSON/state/export artifacts needed to inspect findings and publish selected ones as GitHub issues or PRs. It does not generate architecture, code-quality, roadmap, summary, or deep-review reports for that run.
