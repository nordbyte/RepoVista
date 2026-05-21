# Architecture

RepoVista is a TypeScript CLI. The runtime flow is intentionally narrow: collect evidence, run provider phases, validate results, persist state, and expose reports.

## Runtime flow

1. `src/cli.ts` parses commands and loads settings.
2. `src/audit.ts` orchestrates inventory, checks, project scan, phase execution, exports, and state updates.
3. `src/provider-runner.ts` invokes the selected provider adapter.
4. `src/reports.ts`, `src/exporters.ts`, and related modules write Markdown, structured JSON, SARIF, JSONL, and HTML.
5. `src/finding-state.ts` persists finding lifecycle state.
6. `src/report-browser.ts` and `src/finding-menu.ts` provide terminal UIs.

## Key modules

| Module | Responsibility |
| --- | --- |
| `src/options.ts` | CLI parsing and validation. |
| `src/option-registry.ts` | Shared option, default, setting, and menu registry. |
| `src/audit-context.ts` | Evidence collection and context shaping. |
| `src/phase-runner.ts` | Phase execution and status tracking. |
| `src/evidence-validation.ts` | Finding evidence checks. |
| `src/quality-gates.ts` | Report quality scoring and warnings. |
| `src/report-repair.ts` | Provider repair loop for weak reports. |
| `src/github-source.ts` | GitHub source cloning and metadata. |
| `src/publish.ts` | GitHub issue and PR publishing. |
| `src/github-status.ts` | On-demand linked GitHub issue and PR status refresh. |
| `src/patch-commands.ts` | Fix, patch, rollback, and open-pr workflows. |

## Source of truth

The option registry is the source of truth for defaults, CLI flags, persisted settings, and settings-menu coverage.
