# Publishing

RepoVista audits are read-only by default. Publishing is explicit and uses the GitHub CLI (`gh`).

## Issues from findings

```sh
repovista issue fnd_abc123def456 --dry-run
repovista issue fnd_abc123def456 --label repovista --assignee octocat
repovista issue fnd_abc123def456 --update-existing
repovista issue --all --sync-issues --update-existing --reopen-issues
```

Issues are deduplicated by finding id.

## GitHub-source publishing

Reports created with `--github-repo` can publish selected findings back to that source repository:

```sh
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --dry-run
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --publish-language German
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as pr --dry-run
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as pr --fork
```

Issue publishing targets the repository recorded in `meta.source.repository`, not whichever checkout is current.

## Contribution policy

```sh
repovista publish fnd_abc123def456 --run <run> --as issue --contribution-policy enforce
repovista publish fnd_abc123def456 --run <run> --as issue --contribution-policy warn
repovista publish fnd_abc123def456 --run <run> --as issue --contribution-policy off
```

`enforce` blocks public security disclosures and guideline conflicts, `warn` allows publishing with warnings, and `off` skips guideline handling.

## TUI queues

Inside `repovista reports` and `repovista findings-ui`, use the finding views to queue issue or PR actions, review them, dry-run them, and publish after confirmation.
