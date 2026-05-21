# Reports and State

## Run Directory

Each audit writes a timestamped run directory under the selected output root:

```text
.repovista/
  baseline.json
  cache/
  features/
  findings/
  locks/
  patches/
  project-map.json
  sources/
    github/
      owner/
        repo/
          <commit>/
  2026-05-18T14-57-32-123Z/
    00-inventory.md
    01-architecture-report.md
    02-code-quality-report.md
    03-risk-and-bug-report.md
    04-feature-roadmap.md
    index.md
    meta.json
    prompt-manifest.json
    structured-reports.json
    summary.json
    findings.json
    features.json
    report.json
    report.html
    findings.jsonl
    findings.sarif
    github-annotations.json
    shards/
    deep-review/
    logs/
```

`index.md` is the Markdown entry point. `report.html` is the browser-first dashboard with severity/status counts, collapsible findings, evidence snippets, full Markdown report sections, previous-run comparison, phase-quality diagnostics, suppressed findings, and artifact download links. When `--github-repo` is used, `sources/github/` stores the commit-pinned checkout used for analysis, while the generated run remains in the local output root.

Use `repovista reports` to browse completed runs in the terminal, select a run, and navigate the full combined report, generated finding/evidence views, each Markdown section, a report-health panel, or grouped comparison with the previous run. Successful interactive audits open this same browser on the newly created run instead of ending at the run-directory message. The report list is sorted by run creation time with the newest run first and shows the total run duration after the exit code. Section lists show line count and generation duration where metadata is available.

The report viewer highlights Markdown headings, bold spans, inline code, links, blockquotes, lists, code blocks, and search matches in color-capable terminals. Markdown tables are rendered with aligned columns. `/` searches the current section, `n` jumps to the next hit, `g` opens global search across the current run or all runs, `o` opens an outline/table of contents, `f` and `t` cycle severity/status filters, `r` cycles workflow filters, `e` opens evidence refs/previews, `c` opens grouped compare outside finding views, and `?` shows context help. Finding views support sorting by severity, confidence, status, owner, SLA, path, or first seen; direct triage with `1` through `5`; Space/`i`/`p`/`0` publish queue editing; `c` to review mixed issue/PR queues; publish-readiness labels; evidence previews with local file snippets; editor jumps through `REPOVISTA_EDITOR`, `VISUAL`, or `EDITOR`; temporary bookmarks; layout presets; and Markdown/JSON/HTML/SARIF exports of the current view. In the run list, Space marks or unmarks report runs for deletion, and `d` opens a confirmation screen before the marked run directories are removed.

## Main Files

| File | Purpose |
|---|---|
| `00-inventory.md` | Project inventory and evidence pack. |
| `01-architecture-report.md` | Architecture review. |
| `02-code-quality-report.md` | Code quality and maintainability review. |
| `03-risk-and-bug-report.md` | Risk, bug, and security finding report. |
| `04-feature-roadmap.md` | Feature and improvement roadmap. |
| `index.md` | Summary entry point linking all phase outputs. |
| `meta.json` | Run metadata, source repository when applicable, provider/model/reasoning/fast mode, snapshot/drift state, total and per-report durations, phase status, quality, cache, workspace, and analytics. Analytics include estimated prompt tokens and provider-reported token/cost telemetry when the provider output exposes it. |
| `summary.json` | Machine-readable run summary, including source metadata when applicable. |
| `report.json` | Complete machine-readable run artifact, including source metadata when applicable. |
| `structured-reports.json` | Normalized structured phase reports. |
| `prompt-manifest.json` | Prompt context manifest, file hashes, inclusion reasons, omissions, diff scope, and token estimates. |
| `findings.json` | Active structured findings. |
| `features.json` | Run-specific semantic feature map. |
| `report.html` | Browser dashboard with finding filters, collapsible findings, evidence snippets, full Markdown sections, previous-run comparison, evidence quality, phase quality, suppressed findings, and artifact links when exported. |
| `findings.jsonl` | Finding export for line-oriented processing. |
| `findings.sarif` | SARIF export for security tooling. |
| `github-annotations.json` | GitHub annotation export. |

## Evidence Pack

The evidence pack is collected before provider phases and records:

- Node.js, npm, OS, and package metadata.
- Git branch, commit, dirty state, remote, and short status.
- Selected provider id, display name, executable, availability, and version.
- Optional local check commands and results.

Provider reports must distinguish their own read-only analysis from evidence pack checks. For example, a provider should not claim "I did not run tests" when the evidence pack contains completed test output.

## Quality Gates

RepoVista validates generated reports for structure and depth. Quality gates check:

- Required sections.
- Schema findings and roadmap proposal fields.
- Path references and evidence reference counts.
- Existing line ranges, quotes, tests, reproduction steps, suggested regression tests, and minimum fix scope.
- Report wording that correctly describes evidence pack checks.

With `--strict-reports`, quality warnings mark the phase failed. With `--repair-reports`, RepoVista asks the provider to repair missing or weak report content.

Repair attempts are visible in progress output when they start. Each attempt is also recorded under the phase entry in `meta.json` as `repairAttempts[]`, including the triggering warnings, repair phase id, status, duration, error text when present, and provider diagnostics. `repovista review` surfaces the same repair history in the report checks section.

## Structured Findings

Risk findings use stable ids and include:

- `id`, `title`, `severity`, `category`, `status`, owner, labels, SLA, issue/PR links, and stable signature.
- Affected paths.
- Evidence text and structured evidence references.
- Recommendation, rationale, reproduction, suggested regression test, and minimum fix scope.
- Effort, confidence, feature id, parent/child finding metadata, and history.

For providers with native schema support, RepoVista requests provider-native JSON and renders Markdown from it. Providers without native schemas can emit the `repovista-findings` sentinel block.

## Persistent State

`.repovista/` stores durable state:

| Path | Purpose |
|---|---|
| `.repovista/project-map.json` | Project areas, semantic features, language/framework data, and parallel recommendations. |
| `.repovista/features/` | Versioned feature records with status, owners, linked findings, patch attempts, and history. |
| `.repovista/findings/` | Persistent finding lifecycle state. |
| `.repovista/patches/` | Fix attempt records. |
| `.repovista/locks/` | Feature claim locks for parallel and deep-review work. |
| `.repovista/cache/` | Scan and phase reuse metadata. |
| `.repovista/baseline.json` | Accepted suppressions. |

Findings, features, cache, and other internal state use a shared versioned state layer that can read legacy files and apply schema migration logic. The cache records global scan reuse plus phase, feature, and shard fingerprints, so unchanged successful phase artifacts or shard reports can be reused when compatible even if unrelated files changed.

## Workspace Matrix

`repovista audit --workspace-matrix` detects package workspaces, runs a normal audit for each selected workspace, and writes an aggregate run under `.repovista/workspace-matrix-<timestamp>/` with:

- `index.md` for a human-readable matrix table.
- `workspace-matrix.json` for machine-readable workspace status, report paths, exit codes, and finding counts.

Use `--workspace <name-or-path>` with `--workspace-matrix` to restrict the matrix to one detected workspace.

## Compare Output

```sh
repovista compare .repovista/old-run .repovista/new-run
repovista compare .repovista/old-run .repovista/new-run --format json
repovista compare .repovista/old-run .repovista/new-run --format html
```

Compare evaluates:

- Finding count deltas.
- Added, resolved, and persisting findings.
- Resolved old findings.
- Proposal deltas.
- Evidence-quality deltas.
- Report depth and evidence-reference deltas.
- Provider, model, and reasoning differences.

`--fail-on-regression` exits with code `2` when the new run adds critical or high findings.
