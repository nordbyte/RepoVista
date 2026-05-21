# Workspaces

RepoVista detects npm and yarn package workspaces plus `pnpm-workspace.yaml`.

## Focus one workspace

```sh
repovista audit --workspace packages/api
```

Use this when one package or service should dominate inventory, prompts, checks, and findings.

## Include all workspaces

```sh
repovista audit --all-workspaces
```

This records all detected workspaces in the evidence pack.

## Workspace matrix

```sh
repovista audit --workspace-matrix
```

Workspace matrix mode runs one audit per detected workspace and writes an aggregate matrix summary under `.repovista/workspace-matrix-*`.

`--github-repo` cannot be combined with `--workspace-matrix` yet.
