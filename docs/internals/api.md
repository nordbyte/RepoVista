# API reference

RepoVista publishes TypeScript declarations from `dist/` in the npm package.

## Entry point

```ts
import { runAudit } from "repovista";
```

The public package entry is `dist/index.js` with types from `dist/index.d.ts`.

## Stability

The CLI is the primary stable interface. Programmatic APIs are useful for integration, but should be pinned to a RepoVista version and reviewed when upgrading.

## Useful modules

| Export area | Use it for |
| --- | --- |
| audit runner | start an audit from code |
| provider helpers | inspect provider adapters and capabilities |
| report types | consume structured reports and findings |
| option types | build typed option objects |

For the most exact current API surface, inspect `dist/index.d.ts` after `npm run build`.
