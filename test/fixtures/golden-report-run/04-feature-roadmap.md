# Feature and Improvement Roadmap

## Executive Summary

The fixture roadmap validates six complete proposals tied to `src/project-map.ts`, `src/provider-schema.ts`, `src/exporters.ts`, `src/finding-state.ts`, `src/compare.ts`, and `.github/workflows/ci.yml`.

## Useful Improvements to Existing Features

- Refresh stale project maps from `src/project-map.ts`.
- Improve exports in `src/exporters.ts`.

## Useful New Features

- Add report review commands in `src/report-review.ts`.
- Add PR comment output from `src/report-review.ts`.

## Prioritized Roadmap

The structured schema below is the source of truth for this golden fixture.

```json
{
  "schemaVersion": 1,
  "phaseId": "feature-roadmap",
  "executiveSummary": "Six roadmap proposals validate report quality gates.",
  "keyPoints": ["Golden report fixtures should stay concrete."],
  "evidenceReferences": ["src/project-map.ts", "src/provider-schema.ts", "src/exporters.ts", "src/finding-state.ts", "src/compare.ts", ".github/workflows/ci.yml"],
  "recommendations": ["Keep fixture proposals complete."],
  "proposals": [
    {"title":"Refresh project maps","description":"Warn when project maps are stale.","evidence":["src/project-map.ts"],"benefit":"Parallel plans stay accurate.","effort":"small","risk":"Low migration risk.","affected":["src/project-map.ts"],"steps":["Compare current scan to saved map."],"priority":"P0","confidence":"high"},
    {"title":"Schema all phases","description":"Use native schemas for every phase.","evidence":["src/provider-schema.ts"],"benefit":"Reports are easier to validate.","effort":"medium","risk":"Provider compatibility varies.","affected":["src/provider-schema.ts"],"steps":["Add generic phase schema."],"priority":"P0","confidence":"high"},
    {"title":"Interactive HTML","description":"Filter findings in HTML output.","evidence":["src/exporters.ts"],"benefit":"Large reports are easier to consume.","effort":"small","risk":"Static browser compatibility.","affected":["src/exporters.ts"],"steps":["Add controls and client filtering."],"priority":"P1","confidence":"high"},
    {"title":"Finding revalidation scope","description":"Limit revalidation to changed files.","evidence":["src/finding-state.ts"],"benefit":"Triage loops are faster.","effort":"small","risk":"Diff refs can be missing.","affected":["src/finding-state.ts"],"steps":["Intersect findings with diff scope."],"priority":"P1","confidence":"medium"},
    {"title":"Compare improvements","description":"Show richer deltas in compare output.","evidence":["src/compare.ts"],"benefit":"Report quality changes are visible.","effort":"medium","risk":"Output may become verbose.","affected":["src/compare.ts"],"steps":["Add proposal and evidence deltas."],"priority":"P2","confidence":"medium"},
    {"title":"CI report template","description":"Provide ready-to-use CI report artifacts.","evidence":[".github/workflows/ci.yml"],"benefit":"Adoption is simpler.","effort":"small","risk":"Repository needs vary.","affected":[".github/workflows/ci.yml"],"steps":["Keep generated workflow conservative."],"priority":"P2","confidence":"medium"}
  ]
}
```
