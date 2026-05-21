# Quickstart

Run RepoVista from the root of a Git repository:

```sh
repovista
```

This is the same as:

```sh
repovista audit
```

RepoVista writes the main report to:

```text
.repovista/<run-id>/index.md
```

## First useful commands

```sh
repovista settings
repovista doctor
repovista plan
repovista audit
repovista reports
repovista findings-ui
```

## Common audit examples

```sh
repovista audit --model gpt-5.5
repovista audit --provider claude --model sonnet --reasoning high
repovista audit --github-repo nordbyte/RepoVista
repovista audit --github-repo https://github.com/nordbyte/RepoVista --github-ref v0.4.0
repovista audit --no-parallel
repovista audit --since origin/main
repovista audit --ci --json --fail-on-critical
```

## Open reports

```sh
repovista reports
```

The report browser lists runs newest-first and lets you open generated sections, search, filter findings, bookmark items, compare with previous runs, export the current view, and queue GitHub publishing actions.

## Manage findings

```sh
repovista findings
repovista next
repovista show fnd_abc123def456
repovista triage fnd_abc123def456 --status fixed --note "validated"
```

Use [Findings](../guides/findings.md) for lifecycle details and [Publishing](../guides/publishing.md) for GitHub issue or PR publishing.
