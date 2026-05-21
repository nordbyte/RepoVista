# Finding and Fix Workflows

## Finding Lifecycle

RepoVista persists findings under `.repovista/findings/`. Each finding has a stable id such as `fnd_abc123def456`.

Common commands:

```sh
repovista findings
repovista findings --json
repovista findings --export sarif,github
repovista findings-ui
repovista reports
repovista next
repovista show fnd_abc123def456
repovista triage fnd_abc123def456 --status fixed --note "validated"
repovista triage --all --status uncertain --note "needs review"
```

`repovista reports` opens the shared RepoVista TUI shell for completed audit reports. It lists existing run directories newest-first by creation time, opens a selected run, and lets you navigate the full combined report, generated sections, report health, findings, evidence previews, grouped compare, global search, bookmarks, and current-view exports. Markdown headings, bold spans, inline code, links, blockquotes, lists, code blocks, search hits, and aligned Markdown tables are rendered in color-capable terminals. In finding views, Space marks findings, `i` prepares GitHub issues, and `p` prepares pull requests for reports created with `--github-repo`. In the run list, Space marks runs for deletion, and `d` opens a confirmation screen before RepoVista removes the marked run directories.

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

## Publishing GitHub-Source Findings

Reports created with `--github-repo` can publish selected findings back to that source repository. Publishing is explicit and uses the GitHub CLI (`gh`); audits remain read-only.

```sh
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --dry-run
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --label repovista
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as pr --dry-run
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as pr --fork
```

Issue publishing targets the repository recorded in `meta.source.repository`, not the current local checkout. Issue bodies include the analyzed commit, RepoVista run id, finding metadata, and GitHub permalink evidence refs such as `blob/<commit>/<path>#L10-L20`. Existing issues are detected by a hidden `repovista:finding:<id>` marker; use `--update-existing`, `--sync-issues`, and `--reopen-issues` to control updates.

Pull request publishing creates a separate generated worktree under `.repovista/publish/<run-id>/<patch-id>/worktree`, asks the configured provider to patch the selected finding(s), applies the patch scope gate, records a patch attempt under `.repovista/patches/`, commits the patch, and opens a PR against the source repository. RepoVista first tries to push a branch to the source remote; if that fails, or if `--fork` is set, it uses `gh repo fork` and opens the PR from the fork.

Inside `repovista reports`, open a GitHub-source run, enter the Findings view, mark findings with Space, then press `i` for issues or `p` for PRs. The confirmation screen shows the selected findings and supports `d` for a dry-run preview before Enter publishes.

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
