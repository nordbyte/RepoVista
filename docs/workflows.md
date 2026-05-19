# Finding and Fix Workflows

## Finding Lifecycle

RepoVista persists findings under `.repovista/findings/`. Each finding has a stable id such as `fnd_abc123def456`.

Common commands:

```sh
repovista findings
repovista findings --json
repovista findings --export sarif,github
repovista findings-ui
repovista reports-ui
repovista next
repovista show fnd_abc123def456
repovista triage fnd_abc123def456 --status fixed --note "validated"
repovista triage --all --status uncertain --note "needs review"
```

`repovista reports-ui` opens the shared RepoVista TUI shell for completed audit reports. It lists existing run directories, opens a selected run, and lets you navigate the full combined report or individual generated sections.

Supported statuses:

- `open`
- `fixed`
- `false-positive`
- `wont-fix`
- `uncertain`

## Revalidation

Local revalidation checks finding evidence against the current checkout:

```sh
repovista revalidate fnd_abc123def456
repovista revalidate --all
repovista revalidate --all --since origin/main
```

Provider revalidation asks the configured provider for a read-only decision:

```sh
repovista revalidate fnd_abc123def456 --provider-revalidate
```

Evidence validation checks path safety, existence, line ranges, quotes, and prompt-manifest context where available.

## Baseline and Suppressions

Use a baseline for accepted risks or known false positives that should be omitted from active outputs:

```sh
repovista baseline list
repovista baseline add fnd_abc123def456 --note "accepted risk"
repovista baseline remove fnd_abc123def456
repovista baseline prune
repovista suppress fnd_abc123def456 --note "accepted risk"
```

Suppressed findings remain recorded in machine-readable outputs as suppressed findings.

## GitHub Issues

`repovista issue` uses the GitHub CLI (`gh`):

```sh
repovista issue fnd_abc123def456 --dry-run
repovista issue fnd_abc123def456 --label repovista --assignee octocat
repovista issue fnd_abc123def456 --update-existing
```

Issues are deduplicated by finding id. `--update-existing` adds fresh context to an existing issue instead of creating a duplicate.

## Fix Workflow

`repovista fix` is opt-in and can write to the working tree. It does not commit or push.

Preview:

```sh
repovista fix fnd_abc123def456 --dry-run
```

Apply with guardrails:

```sh
repovista fix fnd_abc123def456 \
  --isolate-branch \
  --post-revalidate \
  --max-files 4 \
  --check "npm test"
```

The fix workflow records:

- Base commit.
- Optional isolated branch.
- Pre-diff and post-diff.
- Scope gate result.
- Local validation commands.
- Optional post-fix revalidation.
- Provider output.

Patch attempts are stored under `.repovista/patches/`.

Inspect attempts:

```sh
repovista patches
repovista patches pat_abc123def456 --json
```

Open a pull request:

```sh
repovista open-pr pat_abc123def456 --dry-run
repovista open-pr pat_abc123def456 --base main --branch repovista/fix-abc --title "Fix RepoVista finding"
```

## Locks and Feature State

Parallel and deep-review workflows use feature locks under `.repovista/locks/`. Clean stale locks:

```sh
repovista clean-locks
repovista clean-locks --force
```
