# Core concepts

## Run directory

Each audit writes one timestamped directory under `.repovista/`. The combined report is `index.md`; phase reports, structured JSON, exports, metadata, findings, and logs live beside it.

## Evidence pack

Before provider analysis starts, RepoVista collects local facts: runtime versions, Git status, package metadata, workspace information, selected files, provider diagnostics, and optional local checks.

## Provider

A provider is a local CLI adapter. Built-in providers include `codex`, `claude`, `gemini`, `opencode`, and `aider`. Provider plugins can add more adapters when explicitly trusted.

## Phase

An audit is split into focused phases:

- `architecture`
- `code-quality`
- `risk-and-bug`
- `feature-roadmap`
- `summary`

Use `--phase <id>` to run selected phases.

Bug-findings mode, enabled with `--bug-findings` or the `bugFindingsOnly` setting, intentionally runs only `risk-and-bug`. It still collects inventory, evidence, feature map, metadata, findings, exports, and publish-ready state, but skips architecture, code-quality, roadmap, summary, and feature-sliced deep-review reports.

## Finding

A finding is a structured risk item with a stable id, severity, category, affected paths, evidence references, rationale, recommended fix, reproduction guidance, regression-test suggestion, lifecycle status, linked GitHub issue or PR status, and lifecycle history.

## Project map

The project map records repository structure and feature areas. `parallel=auto` can create `.repovista/project-map.json` on the first audit, and `repovista init` refreshes it explicitly.

## State layer

RepoVista persists findings, feature state, baselines, patches, scan cache, locks, GitHub links, and refreshed GitHub issue/PR status under `.repovista/`.
