# Security Model

RepoVista is read-only by default. It is designed to help humans audit repositories, not to automatically modify code.

## Default Safety Properties

- Provider runs use read-only intent by default.
- Full-access sandbox modes are rejected.
- Report output paths are validated before writes.
- RepoVista writes audit artifacts under the selected report output directory.
- Sensitive values in read metadata are masked.
- `.env` contents are not included in reports.
- Old `.repovista` reports, VCS metadata, dependencies, build outputs, caches, coverage, media, and archives are ignored by default.
- `--include` can add selected ignored paths back, but not VCS metadata or the active report directory.
- No provider CLI is installed automatically.
- No release is created automatically.
- No telemetry is enabled.

## Provider Privacy

The selected provider CLI can read the repository and may send source code to its configured AI service. Use RepoVista only when you have permission and privacy clearance for that provider.

## Local Check Commands

`--run-checks` is opt-in because check commands can execute repository scripts and may create artifacts.

```sh
repovista audit --run-checks --check "npm test"
```

In CI mode, failed checks can make the run fail.

## Write Workflows

`repovista fix` is the only built-in workflow that intentionally requests write mode. It:

- requires explicit user action,
- can run on an isolated branch,
- records pre/post diff,
- runs patch-scope gates,
- can revalidate after the fix,
- stores patch attempts under `.repovista/patches/`,
- does not commit,
- does not push.

## Provider Plugins

Environment-configured provider plugins are treated as user-controlled configuration. Repository-local provider plugins require explicit trust before execution:

```sh
repovista audit --provider custom --allow-repo-provider-plugin
```

or:

```sh
REPOVISTA_TRUSTED_PROVIDER_PLUGIN_DIRS=/trusted/plugins repovista audit --provider custom
```

Review `repovista.providers.json` before allowing execution.

## Secret Masking

RepoVista masks sensitive values in errors, logs, provider failure output, metadata objects, and common environment assignment patterns. Secret masking is a defense-in-depth measure and should not be treated as permission to include secrets in prompts or reports.

## Recommended Safe Audit Command

```sh
repovista audit --sandbox read-only --run-checks --strict-reports
```
