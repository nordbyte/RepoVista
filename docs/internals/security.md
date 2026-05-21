# Security model

RepoVista is an audit assistant. It is not a replacement for tests, manual review, SAST, dependency scanning, or a security assessment.

## Read-only default

Audits use read-only intent by default:

```sh
repovista audit --sandbox read-only
```

`workspace-write` is reserved for workflows that need writes, such as `repovista fix`.

## Provider trust

RepoVista sends repository context to the selected provider CLI. Only run it on repositories and with providers you are allowed to use.

## Provider plugin trust

Repository-local provider plugins can define arbitrary executables. RepoVista loads them for discovery but will not execute them unless explicitly allowed:

```sh
repovista audit --provider custom --allow-repo-provider-plugin
```

or:

```sh
REPOVISTA_TRUSTED_PROVIDER_PLUGIN_DIRS=/trusted/plugins repovista audit --provider custom
```

## Secrets

RepoVista avoids including obvious secret-like content where its ignore and evidence rules apply, but you should still use repository-level secret scanning and `.gitignore`/ignore rules for private files.

## Writes and remote actions

- `audit`, `doctor`, `plan`, `reports`, `findings`, and `review` are non-mutating except for RepoVista output/state files.
- `fix` can write local code and records patch attempts, but it does not commit or push.
- `issue`, `publish`, and `open-pr` can create or update GitHub resources after explicit command invocation.
- `--dry-run` is supported by publishing, issue, CI-init, patch preview, rollback preview, and related workflows.
