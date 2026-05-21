# Development

## Setup

```sh
git clone https://github.com/nordbyte/RepoVista.git
cd RepoVista
npm ci
npm run build
```

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run security:audit
```

`npm test` builds first and then runs the test harness.

## Docs

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

The public docs are built from `docs/` and deployed to GitHub Pages by `.github/workflows/pages.yml`.

## Packaging

```sh
npm pack --dry-run
```

The npm package includes `dist`, `docs`, `README.md`, and `LICENSE`.
