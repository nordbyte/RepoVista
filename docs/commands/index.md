# CLI command reference

This reference lists every current RepoVista command. Each command has a dedicated page with usage, important options, examples, and related workflows.

## Audit and setup

| Command | Purpose |
| --- | --- |
| [`repovista`, `repovista audit`](audit.md) | Run a full audit in the current directory. |
| [`repovista init`](init.md) | Initialize or refresh the project map. |
| [`repovista plan`](plan.md) | Show the recommended parallel execution plan. |
| [`repovista doctor`](doctor.md) | Check provider, plugin, workspace, Git, settings, and output readiness. |
| [`repovista providers`](providers.md) | List loaded providers or test one provider executable. |
| [`repovista profiles`](profiles.md) | List built-in audit profiles. |
| [`repovista ci init`](ci-init.md) | Create a GitHub Actions workflow. |

## Reports

| Command | Purpose |
| --- | --- |
| [`repovista reports`](reports.md) | Browse completed report runs and sections in a terminal UI. |
| [`repovista compare`](compare.md) | Compare two RepoVista run directories. |
| [`repovista review`](review.md) | Review one run for quality, evidence, and stale state risks. |
| [`repovista repair-run`](repair-run.md) | Rebuild run artifacts from provider-native structured outputs. |
| [`repovista pr-comment`](pr-comment.md) | Render or post a pull request summary comment. |

## Findings

| Command | Purpose |
| --- | --- |
| [`repovista findings`](findings.md) | List persisted or run-specific findings, emit JSON, or export them. |
| [`repovista findings-ui`](findings-ui.md) | Open the interactive finding management TUI. |
| [`repovista next`](next.md) | Show the next prioritized finding. |
| [`repovista show`](show.md) | Show one persisted finding with evidence and history. |
| [`repovista triage`](triage.md) | Update lifecycle status. |
| [`repovista revalidate`](revalidate.md) | Re-check finding evidence. |
| [`repovista baseline`](baseline.md) | Manage baseline suppressions. |
| [`repovista suppress`](suppress.md) | Shortcut for adding a finding to the baseline. |
| [`repovista clean-locks`](clean-locks.md) | Remove stale RepoVista feature locks. |

## Publishing and fixes

| Command | Purpose |
| --- | --- |
| [`repovista issue`](issue.md) | Create, update, or sync GitHub issues through `gh`. |
| [`repovista publish`](publish.md) | Publish GitHub-source findings as issues or pull requests. |
| [`repovista fix`](fix.md) | Create an isolated patch attempt for one or more findings. |
| [`repovista patches`](patches.md) | List or preview patch attempts. |
| [`repovista rollback`](rollback.md) | Reverse a recorded patch diff. |
| [`repovista open-pr`](open-pr.md) | Create a pull request for a completed patch attempt. |

## Settings and help

| Command | Purpose |
| --- | --- |
| [`repovista settings`](settings.md) | Edit, read, set, or reset persisted defaults. |
| [`repovista help`, `repovista version`](help-version.md) | Show help or version information. |

## Global options

All current flags are listed in [CLI options](../reference/options.md).
