# Reports and state

RepoVista writes human-readable and machine-readable artifacts below `.repovista/`.

## Open the report browser

```sh
repovista reports
```

The browser supports:

- run selection newest-first
- section navigation
- report health summaries
- finding filters and sorting
- evidence previews
- grouped compare views
- global search
- bookmarks
- current-view export
- issue and PR publish queues
- deletion of marked runs after confirmation

## Generated exports

Fresh installs export findings as:

- `findings.sarif`
- `findings.jsonl`
- `report.html`

Add GitHub annotations with:

```sh
repovista audit --export sarif,html,jsonl,github
```

## Compare runs

```sh
repovista compare .repovista/old-run .repovista/new-run
repovista compare .repovista/old-run .repovista/new-run --format json
repovista compare .repovista/old-run .repovista/new-run --fail-on-regression
```

Compare gates can fail on new critical, high, or medium findings. See [compare](../commands/compare.md).

## State directories

| Path | Purpose |
| --- | --- |
| `.repovista/findings/` | persisted finding records and lifecycle history |
| `.repovista/features/` | feature state and locks |
| `.repovista/cache/` | scan fingerprints and reusable metadata |
| `.repovista/patches/` | recorded patch attempts |
| `.repovista/project-map.json` | repository map used for planning and parallel work |

See [Output files](../reference/output-files.md).
