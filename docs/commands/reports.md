# reports

Browse completed RepoVista report runs and sections in an interactive terminal UI.

## Usage

```sh
repovista reports
```

## What it supports

- run list sorted newest-first
- combined report and phase sections
- report health
- findings with evidence previews
- grouped compare
- search
- bookmarks
- current-view export
- issue and PR queues with linked GitHub status refresh
- marked-run deletion with confirmation

In the findings list or detail view, press `g` to refresh the selected finding's linked GitHub issue or pull request status. Press `G` to refresh all visible findings.

## Related commands

```sh
repovista compare .repovista/base .repovista/head
repovista findings-ui
repovista review .repovista/2026-05-21T10-00-00-000Z
```
