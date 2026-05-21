# CLI options

This page mirrors the current option registry used by `repovista --help`.

## Audit and source

| Option | Accepted values | Purpose |
| --- | --- | --- |
| `--provider <value>` | `codex`, `claude`, `gemini`, `opencode`, `aider`, plugin id | Report provider. Default: `codex`. |
| `--allow-repo-provider-plugin` | flag | Allow execution of provider plugins declared in this repository. |
| `--parallel <value>` | `off`, `auto`, `1`-`5` | Shared provider-session budget for phases and shards. Default: `auto`. |
| `--refresh` | flag | Refresh cached project metadata for commands that support it. |
| `--no-parallel` | flag | Disable a saved parallel default. |
| `--out <value>` | directory | Report output directory. Default: `.repovista`. |
| `--resume <value>` | run directory | Resume or complete an existing RepoVista run directory. |
| `--github-repo <value>` | `owner/repo` or GitHub URL | Audit a public GitHub repository. |
| `--github-ref <value>` | branch, tag, or full SHA | Ref to audit with `--github-repo`. |
| `--since <value>` | Git ref | Focus on files changed since a ref. |
| `--pr` | flag | PR mode; default diff base is `origin/main` unless `--base` is set. |
| `--no-pr` | flag | Disable saved PR mode. |
| `--base <value>` | Git ref | Base ref for PR or diff-focused audits. |
| `--workspace <value>` | workspace name or path | Limit the audit to one detected workspace. |
| `--all-workspaces` | flag | Record and include all detected workspaces. |
| `--workspace-matrix` | flag | Run one audit per detected workspace and write an aggregate matrix summary. |

## Provider and prompting

| Option | Accepted values | Purpose |
| --- | --- | --- |
| `--audit-profile <value>` | `quick`, `security`, `pr-review`, `release-readiness`, `architecture` | Built-in audit profile. |
| `--review-mode <value>` | `default`, `deslopify`, `security`, `test-gaps` | Risk review focus. |
| `--prompt-file <value>` | file path | Append extra read-only reviewer guidance from a file. |
| `--model <value>` | provider model id | Override provider model. |
| `--profile <value>` | provider profile | Use a provider configuration profile. |
| `--reasoning <value>` | provider-specific effort | Override provider reasoning effort. Default: `xhigh`. |
| `--fast` | flag | Use Codex fast service tier where supported. |
| `--no-fast` | flag | Disable Codex fast service tier. |
| `--sandbox <value>` | `read-only`, `workspace-write` | Provider sandbox intent. Default: `read-only`. |
| `--language <value>` | language name | Report language. Default: `English`. |
| `--publish-language <value>` | language name | GitHub issue/PR language. Default: `English`. |
| `--contribution-policy <value>` | `enforce`, `warn`, `off` | GitHub publish contribution-guideline handling. |

## Scope, checks, quality, and exports

| Option | Accepted values | Purpose |
| --- | --- | --- |
| `--json` | flag | Store metadata, provider logs/events, or emit command JSON where supported. |
| `--include <value>` | comma-separated patterns | Additional include patterns. Repeatable. |
| `--ignore <value>` | comma-separated patterns | Additional ignore patterns. Repeatable. |
| `--phase <value>` | `architecture`, `code-quality`, `risk-and-bug`, `feature-roadmap`, `summary`, `all` | Run selected phase(s). Repeatable or comma-separated. |
| `--run-checks` | flag | Run detected or explicit local checks before analysis. Default: on. |
| `--no-run-checks` | flag | Disable saved run-checks default. |
| `--check <value>` | shell command | Add an explicit local check command. Repeatable. |
| `--check-timeout <value>` | minutes | Timeout per local check command. Default: `5`. |
| `--timeout <value>` | minutes | Timeout per provider phase. Default: `30`. |
| `--phase-timeout <value>` | minutes | Alias for `--timeout`. |
| `--strict-reports` | flag | Fail phases when quality gates warn. Default: on. |
| `--no-strict-reports` | flag | Disable saved strict report default. |
| `--repair-reports` | flag | Ask provider to repair reports that miss quality gates. Default: on. |
| `--no-repair-reports` | flag | Disable saved repair default. |
| `--repair-attempts <value>` | `1`-`3` | Maximum repair attempts per phase. Default: `2`. |
| `--deep-review` | flag | Run feature-sliced risk review passes and merge findings. |
| `--no-deep-review` | flag | Disable saved deep-review default. |
| `--snapshot` | flag | Run provider analysis in a detached Git worktree snapshot. |
| `--incremental` | flag | Record scan-cache metadata and detect unchanged project scans. Default: on. |
| `--export <value>` | `sarif`, `html`, `jsonl`, `github` | Export findings. Comma-separated. Default for audits: `sarif,html,jsonl`. |

## Gates, CI, and compare

| Option | Accepted values | Purpose |
| --- | --- | --- |
| `--fail-on-drift` | flag | Exit `2` when repository drift is detected. |
| `--fail-on-weak-evidence` | flag | Exit `2` when findings contain weak evidence. |
| `--min-quality-score <value>` | `0`-`100` | Minimum accepted phase quality score. |
| `--max-critical <value>` | non-negative integer | Maximum critical findings before exit `2`. |
| `--max-high <value>` | non-negative integer | Maximum high findings before exit `2`. |
| `--max-medium <value>` | non-negative integer | Maximum medium findings before exit `2`. |
| `--max-new-critical <value>` | non-negative integer | Maximum new critical findings in compare before exit `2`. |
| `--max-new-high <value>` | non-negative integer | Maximum new high findings in compare before exit `2`. |
| `--max-new-medium <value>` | non-negative integer | Maximum new medium findings in compare before exit `2`. |
| `--format <value>` | `markdown`, `json`, `html` | Compare output format. |
| `--fail-on-regression` | flag | Exit `2` when compare detects new critical or high findings. |
| `--ci` | flag | CI mode without progress output. |
| `--fail-on-critical` | flag | Exit `2` in CI when critical findings are detected. |
| `--no-progress` | flag | Disable interactive progress TUI and post-audit report browser. |
| `--keep-logs` | flag | Store technical provider logs. |

## Findings, publishing, and patches

| Option | Accepted values | Purpose |
| --- | --- | --- |
| `--finding <value>` | finding id | Finding id for commands that need one. |
| `--run <value>` | run id or run directory | Read findings from a run or publish from a run. |
| `--status <value>` | `open`, `fixed`, `false-positive`, `wont-fix`, `uncertain` | Finding lifecycle status. |
| `--note <value>` | text | Triage, baseline, or issue note. |
| `--label <value>` | label name | GitHub issue label. Repeatable. |
| `--assignee <value>` | GitHub login | GitHub issue assignee. Repeatable. |
| `--update-existing` | flag | Update an existing matching issue instead of creating a duplicate. |
| `--sync-issues` | flag | Create, update, and persist GitHub issue links. |
| `--reopen-issues` | flag | Reopen linked GitHub issues when findings reappear as open. |
| `--as <value>` | `issue`, `pr` | Publish selected findings as issue or pull request. |
| `--fork` | flag | Force fork-based PR publishing for GitHub-source runs. |
| `--owner-rule <value>` | `path-glob=owner` | Assign finding owner by affected path. Repeatable. |
| `--label-rule <value>` | `path-glob=label` | Add finding label by affected path. Repeatable. |
| `--sla-days <value>` | positive integer | Default finding SLA in days. |
| `--patch <value>` | patch id | Patch attempt id for `patches` or `open-pr`. |
| `--branch <value>` | branch name | Branch name for `open-pr`. |
| `--title <value>` | title text | Pull request title. |
| `--all` | flag | Include all finding statuses, revalidate all findings, or refresh all linked GitHub statuses. |
| `--provider-revalidate` | flag | Ask the configured provider to revalidate finding status. |
| `--dry-run` | flag | Preview commands, writes, issues, or workflow content. |
| `--isolate-branch` | flag | Run `fix` on a temporary branch. |
| `--no-isolate` | flag | Run `fix` on the current branch. |
| `--post-revalidate` | flag | Revalidate the fixed finding after `fix`. |
| `--max-files <value>` | `1`-`100` | Maximum changed files allowed by the fix scope gate. |
| `--template <value>` | `pr-light`, `security`, `release-readiness`, `scheduled-audit` | CI template for `ci init`. |
| `--force` | flag | Overwrite generated files or force cleanup where supported. |
| `--version` | flag | Show version. |
| `--help` | flag | Show help. |
