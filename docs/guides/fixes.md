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

The workflow records base commit, optional isolated branch, pre-diff and post-diff, scope gate result, local validation, optional post-fix revalidation, and provider output.

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
