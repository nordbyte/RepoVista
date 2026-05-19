# Development

## Setup

```sh
npm install
npm run build
```

The package is TypeScript and builds to `dist/`.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run golden:reports
npm pack --dry-run
```

`npm test` builds first and runs the test suite with mocked provider processes. It does not call Codex, Claude, or other provider CLIs for real.

`npm run golden:reports` validates bundled full-report fixtures against the same quality gates used for generated reports.

## Local CLI Testing

```sh
node dist/cli.js help
node dist/cli.js doctor
node dist/cli.js settings
```

If the package is linked globally, `repovista` resolves to `dist/cli.js`.

## Project Structure

```text
src/
  cli.ts
  audit.ts
  providers/
  settings-*.ts
  finding-*.ts
  project-*.ts
  quality-gates.ts
  compare.ts
  state-store.ts
test/
docs/
scripts/
```

## Adding a Provider

Prefer a provider plugin when possible. Add a built-in provider only when it needs first-class code support. A built-in provider should define:

- executable and version args,
- capability flags,
- argument builder,
- error classifier,
- output mode,
- tests for argument construction and runner behavior.

## Adding CLI Options

Update these files together:

- `src/cli-schema.ts`
- `src/options.ts`
- `src/types.ts`
- relevant command implementation
- docs in `docs/cli-reference.md`
- option parsing tests

## Release Notes

For RepoVista GitHub releases, use the established release-note structure:

```md
## Changes

- [`shortsha`](https://github.com/nordbyte/RepoVista/commit/fullsha) Commit subject

**Full Changelog**: https://github.com/nordbyte/RepoVista/compare/previous-tag...new-tag
```

Do not create a GitHub or npm release unless explicitly requested.
