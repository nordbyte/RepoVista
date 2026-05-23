# fix

Create an isolated patch attempt for one or more findings.

## Usage

```sh
repovista fix <finding-id[,finding-id...]> [--dry-run] [--check <command>] [--no-run-checks] [--force]
```

## Options

| Option | Purpose |
| --- | --- |
| `--dry-run` | Preview the patch workflow without writing changes. |
| `--check <command>` | Add a validation command. Repeatable. |
| `--no-run-checks` | Skip the validation-command requirement for the patch attempt. |
| `--isolate-branch` | Run on a temporary `repovista/fix-*` branch. |
| `--no-isolate` | Run on the current branch instead. |
| `--post-revalidate` | Revalidate the fixed finding after patching. |
| `--max-files <n>` | Maximum changed files allowed by the scope gate. |
| `--force` | Allow running with a dirty working tree. |
| `--provider <name>` | Provider for the fix workflow. |
| `--model <name>` | Provider model override. |

`fix` always runs the provider with `workspace-write` intent because it is an explicit patch workflow. The normal read-only audit sandbox setting is not used for this command.

## Examples

```sh
repovista fix fnd_abc123def456 --dry-run
repovista fix fnd_abc123def456 --isolate-branch --post-revalidate --max-files 4 --check "npm test"
repovista fix fnd_abc123def456 --no-run-checks
repovista fix fnd_a,fnd_b --check "npm run typecheck"
```

## Output

Patch attempts are recorded under `.repovista/patches/`.
