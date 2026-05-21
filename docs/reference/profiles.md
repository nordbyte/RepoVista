# Audit profiles

List profiles:

```sh
repovista profiles
repovista profiles --json
```

Use a profile:

```sh
repovista audit --audit-profile security
```

## Built-in profiles

| Profile | Purpose |
| --- | --- |
| `quick` | Risk plus summary for a fast orientation pass. |
| `security` | Risk-heavy strict run with checks, repair, and CI-friendly exports. |
| `pr-review` | Diff-focused pull request review with checks and GitHub annotations. |
| `release-readiness` | Full strict pre-release audit with checks, repair, parallel mode, and exports. |
| `architecture` | Architecture and roadmap focus. |

Profiles can be combined with explicit CLI flags. Explicit flags win.
