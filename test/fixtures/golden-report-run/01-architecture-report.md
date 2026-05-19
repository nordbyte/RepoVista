# Architecture Analysis

## Executive Summary

RepoVista is a TypeScript CLI centered on `src/cli.ts`, `src/audit.ts`, `src/provider-runner.ts`, `src/findings.ts`, and `src/audit-outputs.ts`.

## Project Purpose

The project generates read-only repository audits and persists structured findings under `.repovista`.

## Tech Stack

The runtime is Node.js with TypeScript source in `src/`, tests in `test/`, npm scripts in `package.json`, and GitHub Actions in `.github/workflows/ci.yml`.

## Module and Component Overview

`src/cli.ts` dispatches commands, `src/audit.ts` orchestrates phases, `src/provider-runner.ts` runs provider CLIs, `src/findings.ts` normalizes findings, and `src/exporters.ts` writes export formats.

## Data Flow and Control Flow

CLI options move from `src/options.ts` into `src/audit.ts`; evidence from `src/evidence.ts` and project scans from `src/project-scan.ts` are rendered into prompts from `src/prompts.ts`.

## Recommendations

- Keep provider boundaries in `src/providers/`.
- Keep persistent state code in `src/finding-store.ts` and `src/feature-state.ts`.
- Keep report exports in `src/exporters.ts`.

```json
{
  "schemaVersion": 1,
  "phaseId": "architecture",
  "executiveSummary": "RepoVista is a modular TypeScript CLI for read-only repository audits.",
  "keyPoints": ["CLI dispatch is separated from audit orchestration.", "Provider execution is centralized."],
  "evidenceReferences": ["src/cli.ts", "src/audit.ts", "src/provider-runner.ts", "src/findings.ts", "src/exporters.ts"],
  "recommendations": ["Keep provider adapters isolated.", "Keep structured outputs versioned."]
}
```
