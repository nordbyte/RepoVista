# github-status

Refresh linked GitHub issue and pull request status for RepoVista findings.

## Usage

```sh
repovista github-status [finding-id|--all] [--run <run-id|dir>] [--json]
```

Without a finding id or `--all`, RepoVista refreshes findings that already have a linked GitHub issue or pull request.

## Options

| Option | Purpose |
| --- | --- |
| `<finding-id>` | Refresh one finding. Comma-separated ids are accepted. |
| `--all` | Refresh all findings, including linked and unlinked findings. |
| `--run <run-id|dir>` | Refresh findings from one report run and write the updated `findings.json`. |
| `--json` | Emit the sync result and refreshed findings as JSON. |

## Status mapping

Issue state is stored as `open`, `closed`, or `unknown`. Closed issues also keep GitHub's reason when available, such as `completed` or `not-planned`.

Pull request state is stored as `open`, `closed`, `merged`, or `unknown`. Draft PRs render as `PR draft` in the TUI.

Remote GitHub status does not overwrite the RepoVista finding lifecycle status. A merged PR is a signal for triage, but the finding remains `open`, `fixed`, `false-positive`, `wont-fix`, or `uncertain` until you update it.

## Examples

```sh
repovista github-status fnd_abc123def456
repovista github-status fnd_abc123def456 --run 2026-05-21T10-00-00-000Z
repovista github-status --all --run 2026-05-21T10-00-00-000Z --json
```

The `repovista reports` and `repovista findings-ui` TUIs expose the same refresh path with `g` for the selected finding and `G` for all visible findings.
