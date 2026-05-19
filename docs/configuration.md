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

## Supported Settings

| Setting | Type | Purpose |
|---|---|---|
| `provider` | enum | Default provider. |
| `parallel` | enum/number | Default parallel mode: `off`, `auto`, or `1`-`5`. |
| `model` | string | Default provider model. |
| `profile` | string | Default provider profile. |
| `reasoning` | string | Default reasoning effort. |
| `fastMode` | boolean | Use fast provider tier where supported. |
| `sandbox` | enum | Default sandbox intent. |
| `language` | string | Report language. |
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
| `reviewMode` | enum | Risk review focus. |
| `promptFile` | string | Additional prompt guidance file. |
| `exportFormats` | list | Default finding export formats. |
| `json` | boolean | Keep JSON events and metadata. |
| `keepLogs` | boolean | Keep technical logs. |
| `progress` | boolean | Show progress output. |
| `ci` | boolean | CI defaults. |
| `failOnCritical` | boolean | Fail CI on critical findings. |
| `auditProfile` | enum | Built-in audit profile. |
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
```

Use a workspace when one package or service should be emphasized in inventory and prompts.

## Incremental Mode

```sh
repovista audit --incremental
```

Incremental reuse is tied to file hashes, prompt-manifest inputs, provider version, prompt context version, phase schema version, quality-gate version, selected options, and reusable successful artifacts from previous runs. When any reuse condition changes, RepoVista reruns the affected phase.
