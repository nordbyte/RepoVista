# Roadmap

## Executive Summary

RepoVista should keep investing in src/audit.ts, src/findings.ts, src/options.ts, src/quality-gates.ts, src/prompts.ts, test/options.test.mjs and README.md.

## Useful Improvements to Existing Features

### Structured phase reports

- Evidence: src/prompts.ts and src/quality-gates.ts.

### Finding lifecycle exports

- Evidence: src/findings.ts and src/finding-state.ts.

### Settings automation

- Evidence: src/settings-config.ts and src/options.ts.

## Useful New Features

### Provider plugins

- Evidence: src/providers/index.ts and src/provider-runner.ts.

### PR-focused audits

- Evidence: src/git-diff.ts and src/prompts.ts.

### Repair pass

- Evidence: src/audit.ts and src/quality-gates.ts.

## Prioritized Roadmap

| Title | Description | Evidence | Benefit | Effort | Risk | Affected | Steps | Priority | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| Structured phase reports | Add schemas. | src/prompts.ts | Better parsing. | medium | Drift. | src/prompts.ts | Add schema. | P0 | high |
| Finding exports | Add exports. | src/findings.ts | CI integration. | medium | Format drift. | src/findings.ts | Write exporters. | P0 | high |
| Settings automation | Add commands. | src/options.ts | Scriptability. | small | Bad values. | src/options.ts | Validate keys. | P1 | high |
| Provider plugins | Load JSON providers. | src/providers/index.ts | Extensibility. | medium | Unsafe args. | src/providers/index.ts | Add templates. | P1 | medium |
| PR mode | Include name-status. | src/git-diff.ts | Better review focus. | small | Git base missing. | src/git-diff.ts | Parse status. | P2 | high |
| Repair pass | Retry bad reports. | src/audit.ts | Quality. | medium | Cost. | src/audit.ts | Add repair. | P2 | medium |

```json
{
  "schemaVersion": 1,
  "phaseId": "feature-roadmap",
  "executiveSummary": "Golden roadmap fixture.",
  "keyPoints": ["Structured schemas improve report quality."],
  "evidenceReferences": ["src/prompts.ts", "src/quality-gates.ts", "src/findings.ts", "src/options.ts", "src/audit.ts"],
  "recommendations": ["Keep schema output mandatory in prompts."],
  "proposals": [
    {
      "title": "Structured phase reports",
      "description": "Add structured schemas for every phase.",
      "evidence": ["src/prompts.ts"],
      "benefit": "Better machine parsing.",
      "effort": "medium",
      "risk": "Schema drift.",
      "affected": ["src/prompts.ts"],
      "steps": ["Define schema", "Validate output"],
      "priority": "P0",
      "confidence": "high"
    },
    {
      "title": "Finding exports",
      "description": "Export findings for external tools.",
      "evidence": ["src/findings.ts"],
      "benefit": "CI integration.",
      "effort": "medium",
      "risk": "Format mismatch.",
      "affected": ["src/findings.ts"],
      "steps": ["Write SARIF", "Write JSONL"],
      "priority": "P0",
      "confidence": "high"
    },
    {
      "title": "Settings automation",
      "description": "Add settings get set reset.",
      "evidence": ["src/options.ts"],
      "benefit": "Scriptable defaults.",
      "effort": "small",
      "risk": "Invalid persisted values.",
      "affected": ["src/options.ts"],
      "steps": ["Parse keys", "Sanitize values"],
      "priority": "P1",
      "confidence": "high"
    },
    {
      "title": "Provider plugins",
      "description": "Load provider adapters from JSON.",
      "evidence": ["src/providers/index.ts"],
      "benefit": "Extensible providers.",
      "effort": "medium",
      "risk": "Bad command templates.",
      "affected": ["src/providers/index.ts"],
      "steps": ["Load definitions", "Render args"],
      "priority": "P1",
      "confidence": "medium"
    },
    {
      "title": "PR mode",
      "description": "Focus reports on changed files.",
      "evidence": ["src/git-diff.ts"],
      "benefit": "Better review signal.",
      "effort": "small",
      "risk": "Missing base ref.",
      "affected": ["src/git-diff.ts"],
      "steps": ["Parse name-status", "Render prompt"],
      "priority": "P2",
      "confidence": "high"
    },
    {
      "title": "Repair pass",
      "description": "Retry low-quality reports.",
      "evidence": ["src/audit.ts"],
      "benefit": "Higher report quality.",
      "effort": "medium",
      "risk": "Extra provider cost.",
      "affected": ["src/audit.ts"],
      "steps": ["Detect warnings", "Run repair prompt"],
      "priority": "P2",
      "confidence": "medium"
    }
  ]
}
```
