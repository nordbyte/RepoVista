# Settings keys

Use `repovista settings` for the interactive editor, or `settings get`, `settings set`, and `settings reset` for scripts.

## Supported keys

| Key | Type | Purpose |
| --- | --- | --- |
| `provider` | enum | Default provider. |
| `parallel` | enum/number | Default shared provider-session budget: `off`, `auto`, or `1`-`5`. |
| `outDir` | string | Default report output directory. |
| `auditProfile` | enum | Built-in audit profile. |
| `reviewMode` | enum | Risk review focus. |
| `bugFindingsOnly` | boolean | Run only the bug finding report needed for findings, issues, and PRs. |
| `promptFile` | string | Default prompt guidance file. |
| `workspace` | string | Default workspace name or path. |
| `allWorkspaces` | boolean | Include all detected workspaces. |
| `incremental` | boolean | Use scan-cache metadata. |
| `model` | string | Default provider model. |
| `profile` | string | Default provider profile. |
| `reasoning` | string | Default reasoning effort. |
| `fastMode` | boolean | Use fast provider tier where supported. |
| `sandbox` | enum | Default provider sandbox mode. |
| `language` | string | Report language. |
| `publishLanguage` | string | GitHub issue/PR language. |
| `contributionPolicy` | enum | Contribution policy handling: `enforce`, `warn`, `off`. |
| `json` | boolean | Keep JSON provider events and metadata. |
| `includes` | list | Default include patterns. |
| `ignores` | list | Default ignore patterns. |
| `runChecks` | boolean | Run local checks before audit. |
| `checkCommands` | list | Explicit local check commands. |
| `checkTimeoutSeconds` | number | Local check timeout in seconds. |
| `phaseTimeoutSeconds` | number | Provider phase timeout in seconds. |
| `strictReports` | boolean | Fail phases on quality warnings. |
| `repairReports` | boolean | Repair reports that miss quality gates. |
| `repairAttempts` | number | Maximum repair attempts. |
| `deepReview` | boolean | Run feature-sliced risk review. |
| `snapshot` | boolean | Analyze a detached Git snapshot. |
| `failOnDrift` | boolean | Fail when repository drift is detected. |
| `failOnWeakEvidence` | boolean | Fail when findings contain weak evidence. |
| `minQualityScore` | number | Minimum phase quality score. |
| `maxCritical`, `maxHigh`, `maxMedium` | number | Maximum current findings by severity. |
| `exportFormats` | list | Default finding export formats. |
| `keepLogs` | boolean | Keep technical provider logs. |
| `progress` | boolean | Show progress TUI and post-audit browser. |
| `ci` | boolean | Use CI output defaults. |
| `failOnCritical` | boolean | Fail CI on critical findings. |

Boolean values accept `1`, `true`, `yes`, `on`, `0`, `false`, `no`, and `off`.

## Provider plugin trust

Repository-local provider plugins are loaded for discovery but will not execute unless explicitly trusted with `--allow-repo-provider-plugin` or `REPOVISTA_TRUSTED_PROVIDER_PLUGIN_DIRS`.
