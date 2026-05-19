# Architecture

## Runtime Flow

1. Parse CLI args and apply saved settings.
2. Run preflight checks for project shape, output path safety, provider availability, sandbox intent, settings, plugins, Git, and workspaces.
3. Prepare the run directory.
4. Scan project files and collect inventory.
5. Collect the evidence pack.
6. Build prompt manifests and phase prompts.
7. Run provider phases, optionally with parallel shards.
8. Validate quality gates and optionally repair reports.
9. Extract structured phase reports and findings.
10. Write Markdown, JSON, HTML, SARIF, JSONL, GitHub annotations, metadata, and persistent state.

## Main Modules

| Module | Responsibility |
|---|---|
| `src/cli.ts` | Entry point and command dispatch. |
| `src/options.ts` and `src/cli-schema.ts` | CLI parsing, defaults, help text, and validation. |
| `src/audit.ts` | Main audit orchestration. |
| `src/preflight.ts` | Provider, project, output, plugin, settings, Git, and workspace checks. |
| `src/reports.ts` | Run directory creation, path validation, and metadata writing. |
| `src/project-scan.ts` | Project file scanning and ignore handling. |
| `src/inventory.ts` | Human-readable inventory generation. |
| `src/evidence.ts` | Runtime, package, Git, provider, and local-check evidence collection. |
| `src/prompts.ts` | Phase prompt rendering and previous-report context summarization. |
| `src/prompt-manifest.ts` | Prompt input manifest and allowed evidence paths. |
| `src/phase-runner.ts` | Phase execution, repair, validation, and status updates. |
| `src/provider-runner.ts` | Provider process execution and output handling. |
| `src/providers/*` | Built-in provider adapters and plugin loading. |
| `src/provider-schema.ts` | Provider-native schemas and structured output rendering. |
| `src/phase-schema.ts` | Normalized phase report schema extraction. |
| `src/findings.ts` | Finding extraction, schema-first parsing, and counts. |
| `src/quality-gates.ts` | Report depth and evidence quality scoring. |
| `src/project-map.ts` | Project map creation and plan rendering. |
| `src/semantic-features.ts` | Semantic feature detection. |
| `src/work-partitioner.ts` | Area grouping and shard recommendations. |
| `src/deep-review.ts` | Feature-sliced risk review. |
| `src/feature-state.ts` | Durable feature records and locks. |
| `src/finding-state.ts` and `src/finding-store.ts` | Finding lifecycle state. |
| `src/baseline.ts` | Baseline suppression management. |
| `src/patch-commands.ts` | Fix, patch attempt, and PR workflows. |
| `src/compare.ts` | Run comparison and delta rendering. |
| `src/exporters.ts` | SARIF, HTML, JSONL, and GitHub annotation exports. |
| `src/settings-*` | Settings persistence, parsing, and TUI. |
| `src/state-store.ts` | Shared versioned state layer and atomic writes. |
| `src/secrets.ts` | Secret masking helpers. |

## Project Map

`repovista init` writes `.repovista/project-map.json`. It groups files by functional responsibility, including:

- CLI and commands.
- Provider adapters.
- Reports, findings, and evidence.
- Persistent state.
- CI integration.
- Settings.
- Security and trust boundaries.
- Application core.

The map stores recommended thread count and default shard assignments for parallel audits and deep review.

## Parallel Execution

Parallel mode uses a map/reduce structure:

- Map: one provider session per shard writes a partial report.
- Reduce: a synthesis phase merges successful shard reports.
- Summary: final summary remains single-threaded because it depends on completed detail phases.

Parallel mode requires an initialized project map. Resume can reuse shard artifacts only when previous metadata marks them successful and usable.

## Prompt Context

RepoVista avoids blindly embedding full old reports. Previous reports are summarized into phase-specific evidence-oriented excerpts. The prompt manifest records included files, omitted files, hashes where available, inclusion reasons, truncation reasons, semantic features, diff scope, and approximate token counts.
