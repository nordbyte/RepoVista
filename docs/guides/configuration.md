# Configuration

RepoVista uses CLI flags for one command and persisted settings for defaults. CLI flags always win over saved settings.

## Interactive settings

```sh
repovista settings
```

The settings TUI covers provider, model, reasoning, fast mode, sandbox, export formats, check commands, report quality gates, and common runtime behavior.

## Non-interactive settings

```sh
repovista settings get
repovista settings get model
repovista settings set model gpt-5.5
repovista settings set reasoning xhigh
repovista settings set exportFormats sarif,html
repovista settings reset reasoning
repovista settings reset
```

Settings are stored in `~/.config/repovista/settings.json` by default. Override that path with:

```sh
REPOVISTA_CONFIG=/path/to/settings.json repovista settings get
```

## First-run defaults

| Setting | Built-in default |
| --- | --- |
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

`parallel=auto` creates `.repovista/project-map.json` during the first audit when the project has not been initialized yet.

## Profiles

Built-in profiles set opinionated audit behavior:

```sh
repovista profiles
repovista profiles --json
repovista audit --audit-profile security
```

See [Audit profiles](../reference/profiles.md).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `REPOVISTA_CONFIG` | Custom settings file path. |
| `REPOVISTA_PROVIDER_PLUGIN` | Single provider plugin JSON path. |
| `REPOVISTA_PROVIDER_PLUGINS` | Multiple provider plugin paths separated by the platform path delimiter. |
| `REPOVISTA_TRUSTED_PROVIDER_PLUGIN_DIRS` | Trusted directories for plugin execution. |
