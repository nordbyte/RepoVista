# init

Initialize or refresh the RepoVista project map and feature state.

## Usage

```sh
repovista init [options]
```

## Useful options

- `--out <dir>` changes the output root.
- `--refresh` forces metadata refresh where supported.
- `--workspace <name-or-path>` focuses one workspace.
- `--all-workspaces` records all detected workspaces.

## Examples

```sh
repovista init
repovista init --refresh
repovista init --workspace packages/api
```

## Notes

`parallel=auto` can create `.repovista/project-map.json` during the first audit, but `init` is useful when you want to inspect or refresh the map before analysis.
