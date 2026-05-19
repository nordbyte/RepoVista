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

`index.md` is the Markdown entry point. `report.html` is the browser-first dashboard with severity/status counts, evidence checks, phase-quality diagnostics, suppressed findings, and artifact links.

Use `repovista reports-ui` to browse completed runs in the terminal, select a run, and navigate the full combined report or each generated section.

## Main Files

| File | Purpose |
|---|---|
| `00-inventory.md` | Project inventory and evidence pack. |
| `01-architecture-report.md` | Architecture review. |
| `02-code-quality-report.md` | Code quality and maintainability review. |
| `03-risk-and-bug-report.md` | Risk, bug, and security finding report. |
| `04-feature-roadmap.md` | Feature and improvement roadmap. |
| `index.md` | Summary entry point linking all phase outputs. |
| `meta.json` | Run metadata, provider/model/reasoning/fast mode, phase status, quality, cache, workspace, and analytics. |
| `summary.json` | Machine-readable run summary. |
| `report.json` | Complete machine-readable run artifact. |
| `structured-reports.json` | Normalized structured phase reports. |
| `prompt-manifest.json` | Prompt context manifest, file hashes, inclusion reasons, omissions, diff scope, and token estimates. |
| `findings.json` | Active structured findings. |
| `features.json` | Run-specific semantic feature map. |
| `report.html` | Browser dashboard with finding filters, evidence quality, phase quality, suppressed findings, and artifact links when exported. |
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

## Structured Findings

Risk findings use stable ids and include:

- `id`, `title`, `severity`, `category`, `status`, and stable signature.
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

Findings, features, cache, and other internal state use a shared versioned state layer that can read legacy files and apply schema migration logic.

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
