# GitHub source audits

Use `--github-repo` to audit a public GitHub repository without manually cloning it first.

```sh
repovista audit --github-repo nordbyte/RepoVista
repovista audit --github-repo https://github.com/nordbyte/RepoVista --github-ref v0.4.0
```

## Accepted repository values

`--github-repo` accepts:

- `owner/repo`
- `https://github.com/owner/repo`

`--github-ref` accepts a branch, tag, or full commit SHA. If omitted, RepoVista uses the remote HEAD branch.

## Output

RepoVista stores cloned source and report output below the local output root. Run metadata records the source repository and analyzed commit, which later publishing commands use for GitHub permalinks.

## Publishing back to GitHub

Only GitHub-source runs can publish selected findings back to the analyzed repository:

```sh
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as issue --dry-run
repovista publish fnd_abc123def456 --run 2026-05-21T10-00-00-000Z --as pr --dry-run
```

See [Publishing](publishing.md).
