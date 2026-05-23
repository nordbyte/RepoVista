# Fixes and patches

`repovista fix` is opt-in and can write to the working tree. It does not commit or push by itself.

## Preview

```sh
repovista fix fnd_abc123def456 --dry-run
```

## Apply with guardrails

```sh
repovista fix fnd_abc123def456 \
  --isolate-branch \
  --post-revalidate \
  --max-files 4 \
  --check "npm test"
```

The workflow records base commit, optional isolated branch, pre-diff and post-diff, scope gate result, local validation, optional post-fix revalidation, and provider output. Because `fix` is explicitly mutating, it runs the provider with `workspace-write` intent. If local checks are enabled, provide at least one `--check` command or pass `--no-run-checks`.

`fix` refuses a dirty working tree by default. Use `--force` only when the existing local changes are intentional.

## Inspect patch attempts

```sh
repovista patches
repovista patches pat_abc123def456 --json
repovista patches pat_abc123def456 --dry-run
```

Patch attempts live under `.repovista/patches/`.

## Roll back

```sh
repovista rollback pat_abc123def456 --dry-run
repovista rollback pat_abc123def456
```

Rollback reverses the recorded patch diff with `git apply -R`.

## Open a pull request

```sh
repovista open-pr pat_abc123def456 --dry-run
repovista open-pr pat_abc123def456 --base main --branch repovista/fix-abc --title "Fix RepoVista finding"
```

`open-pr` creates a commit, pushes the selected branch, and opens the pull request through `gh`. Use `--force` only when opening a PR for a patch attempt with no recorded changed files is intentional.
