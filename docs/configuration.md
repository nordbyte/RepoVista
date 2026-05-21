# Configuration and Settings

## Interactive Settings

Run:

```sh
repovista settings
```

The settings TUI uses arrow keys for movement, Space for selection, and Enter to open submenus or return to the previous menu. Provider, model, reasoning, fast mode, export formats, and common check commands are selection menus.

## Non-Interactive Settings

```sh
repovista settings get
repovista settings get model
repovista settings set model gpt-5.5
repovista settings set reasoning xhigh
repovista settings set fastMode on
repovista settings set exportFormats sarif,html
repovista settings reset reasoning
repovista settings reset
```

Settings are stored in `~/.config/repovista/settings.json` by default. Override the path with:

```sh
REPOVISTA_CONFIG=/path/to/settings.json repovista settings get
```

CLI flags override saved settings for the current command.

## Built-In Defaults

A fresh install has no persisted settings file yet, so RepoVista falls back to built-in first-run defaults:

| Setting | Built-in default |
|---|---|
| `provider` | `codex` |
| `parallel` | `auto` |
| `reasoning` | `xhigh` |
| `sandbox` | `read-only` |
| `language` | `English` |
| `publishLanguage` | `English` |
| `contributionPolicy` | `enforce` |
| `outDir` | `.repovista` |
| `runChecks` | `true` |
| `strictReports` | `true` |
| `repairReports` | `true` |
| `repairAttempts` | `2` |
| `incremental` | `true` |
| `exportFormats` | `sarif`, `html`, `jsonl` |
| `fastMode`, `deepReview`, `snapshot`, `json`, `keepLogs`, `ci`, `failOnCritical`, `failOnDrift`, `failOnWeakEvidence` | `false` |

`parallel=auto` creates `.repovista/project-map.json` during the first audit if the project has not been initialized yet. The parallel value is a shared provider-session budget for both phase-level parallelism and shard-level map/reduce work. Saved settings only need to be changed when a repository needs different provider, model, workspace, check, export, or runtime behavior.

## Supported Settings

| Setting | Type | Purpose |
|---|---|---|
| `provider` | enum | Default provider. |
| `parallel` | enum/number | Default shared provider-session budget: `off`, `auto`, or `1`-`5`. |
| `model` | string | Default provider model. |
| `profile` | string | Default provider profile. |
| `reasoning` | string | Default reasoning effort. |
| `fastMode` | boolean | Use fast provider tier where supported. |
| `sandbox` | enum | Default sandbox intent. |
| `language` | string | Report language. |
| `publishLanguage` | string | Default GitHub issue/PR language for published findings. |
| `contributionPolicy` | enum | GitHub publish contribution-guideline handling: `enforce`, `warn`, or `off`. |
| `outDir` | string | Report output directory. |
| `includes` | list | Additional include patterns. |
| `ignores` | list | Additional ignore patterns. |
| `runChecks` | boolean | Run local checks before audit. |
| `checkCommands` | list | Explicit local check commands. |
| `checkTimeoutSeconds` | number | Local check timeout in seconds. |
| `phaseTimeoutSeconds` | number | Provider phase timeout in seconds. |
| `strictReports` | boolean | Fail phases on quality warnings. |
| `repairReports` | boolean | Repair reports that miss quality gates. |
| `repairAttempts` | number | Maximum repair attempts. |
| `deepReview` | boolean | Run feature-sliced risk review. |
| `snapshot` | boolean | Run provider analysis in a detached Git worktree snapshot. |
| `failOnDrift` | boolean | Exit `2` when repository drift is detected. |
| `failOnWeakEvidence` | boolean | Exit `2` when findings contain weak evidence. |
| `minQualityScore` | number | Minimum accepted phase quality score, `0`-`100`. |
| `maxCritical`, `maxHigh`, `maxMedium` | number | Maximum allowed current findings by severity before exit `2`. |
| `reviewMode` | enum | Risk review focus: `default`, `deslopify`, `security`, or `test-gaps`. |
| `promptFile` | string | Additional prompt guidance file. |
| `exportFormats` | list | Default finding export formats. |
| `json` | boolean | Keep JSON events and metadata. |
| `keepLogs` | boolean | Keep technical logs. |
| `progress` | boolean | Show the interactive audit progress TUI and post-audit report browser in terminals, with plain progress output as fallback. |
| `ci` | boolean | CI defaults. |
| `failOnCritical` | boolean | Fail CI on critical findings. |
| `auditProfile` | enum | Built-in audit profile; unset means the default full audit. |
| `workspace` | string | Default workspace name or path. |
| `allWorkspaces` | boolean | Include all detected workspaces. |
| `incremental` | boolean | Use scan-cache metadata. |

Boolean settings accept `1`, `true`, `yes`, `on`, `0`, `false`, `no`, and `off`.

## Audit Profiles

| Profile | Purpose |
|---|---|
| `quick` | Risk plus summary for a fast orientation pass. |
| `security` | Risk-heavy strict run with checks, repair, and CI-friendly exports. |
| `pr-review` | Diff-focused pull request review with checks and GitHub annotations. |
| `release-readiness` | Full strict pre-release audit with checks, repair, parallel mode, and exports. |
| `architecture` | Architecture and roadmap focus. |

List profiles:

```sh
repovista profiles
repovista profiles --json
```

## Workspaces

RepoVista detects npm/yarn package workspaces and `pnpm-workspace.yaml`.

```sh
repovista audit --workspace packages/api
repovista audit --all-workspaces
repovista audit --workspace-matrix
```

Use a workspace when one package or service should be emphasized in inventory and prompts. Use `--workspace-matrix` when each workspace should receive its own run directory plus an aggregate matrix summary.

## Incremental Mode

```sh
repovista audit --incremental
```

Incremental reuse is tied to file hashes, prompt-manifest inputs, provider version, prompt context version, phase schema version, quality-gate version, selected options, and reusable successful artifacts from previous runs. RepoVista stores global scan fingerprints plus phase, feature, and shard fingerprints. When the full scan changed but a phase or shard input fingerprint is still compatible, RepoVista can reuse that successful artifact and rerun only the affected work.

## Finding Lifecycle Rules

Owner, label, SLA, and issue-sync metadata are CLI-level audit options:

```sh
repovista audit --owner-rule 'packages/api/**=team-api' --label-rule 'packages/api/**=area-api' --sla-days 14
repovista issue --all --sync-issues --update-existing --reopen-issues --label repovista
```

Rules are matched against affected finding paths. Matching owners, labels, SLA due dates, and GitHub issue/PR links are stored in `.repovista/findings/` and shown by `repovista findings`, `repovista show`, `repovista findings-ui`, `repovista reports`, and the HTML dashboard. The terminal finding views also expose workflow filters for open, critical/high, without issue, without PR, overdue, and GitHub-publishable findings.
