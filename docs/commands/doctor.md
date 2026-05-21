# doctor

Check RepoVista, provider, plugin, workspace, Git, settings, and report-output readiness.

## Usage

```sh
repovista doctor [options]
```

## Useful options

- `--json` emits machine-readable diagnostics where supported.
- `--provider <name>` checks a specific configured provider.
- `--allow-repo-provider-plugin` allows execution of repository-local provider plugins during checks.
- `--out <dir>` checks a non-default output root.

## Examples

```sh
repovista doctor
repovista doctor --json
repovista doctor --provider claude
```

## What it checks

`doctor` is the fastest way to confirm provider availability, plugin trust, workspace detection, Git metadata, settings, and output directory readiness before an audit.
