# plan

Show the recommended parallel execution plan and stale-map warnings without running an audit.

## Usage

```sh
repovista plan [options]
```

## Useful options

- `--parallel <off|auto|1-5>` changes the planned provider-session budget.
- `--refresh` refreshes cached project metadata where supported.
- `--workspace <name-or-path>` focuses one workspace.
- `--all-workspaces` includes all detected workspaces.

## Examples

```sh
repovista plan
repovista plan --parallel 2
repovista plan --workspace packages/api
```

## When to use it

Use `plan` before a large repository audit, after major workspace changes, or when parallel mode is not behaving as expected.
