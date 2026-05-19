# API Reference

RepoVista is primarily a CLI, but the npm package also exposes TypeScript/JavaScript APIs from `dist/index.js`.

```ts
import { runAudit, parseCliArgs } from "repovista";
```

The public API follows the package build and may evolve between minor versions.

## Audit

| Export | Purpose |
|---|---|
| `runAudit(options, context?)` | Run an audit and return the run result. |
| `hasCriticalFindings(runDirOrMarkdown)` | Detect critical findings. |
| `DEFAULT_OPTIONS` | CLI default audit options. |
| `parseCliArgs(argv, defaults?)` | Parse CLI arguments. |
| `renderHelp()` | Render CLI help text. |
| `validateProvider(value)` | Validate provider id. |
| `validateSandbox(value)` | Validate sandbox mode. |
| `parseParallelMode(value)` | Parse parallel mode. |
| `runPreflight(options)` | Run preflight checks without starting an audit. |

Important types:

- `AuditOptions`
- `AuditMeta`
- `AuditProfileId`
- `RunPaths`
- `PhaseReportStatus`
- `CliParseResult`
- `CliAction`
- `ParallelMode`
- `ReviewMode`
- `SandboxMode`

## Providers

| Export | Purpose |
|---|---|
| `getReportProvider(id)` | Return a built-in or loaded plugin provider. |
| `isReportProviderId(value)` | Check provider id. |
| `REPORT_PROVIDER_IDS` | Loaded provider ids. |
| `REPORT_PROVIDERS` | Loaded provider definitions. |
| `runProviderPhase(request)` | Run a provider phase through the generic runner. |
| `runCodexPhase(request)` | Run a Codex phase. |
| `buildCodexExecArgs(request)` | Build Codex CLI args. |
| `buildClaudeExecArgs(request)` | Build Claude Code CLI args. |
| `loadProviderModels(provider)` | Load model catalog for a provider. |
| `reasoningOptionsForProviderModel(provider, models, selectedModel?)` | Resolve reasoning options. |
| `resolveProviderDefaultModel(provider)` | Resolve the configured default model when RepoVista can infer it. |
| `loadCodexModels()` | Load Codex model catalog. |
| `loadCodexConfigDefaults()` | Read Codex CLI default model and reasoning settings from config. |
| `resolveCodexDefaultModel()` | Resolve the Codex CLI configured or bundled default model. |
| `parseCodexModelCatalog(raw)` | Parse `codex debug models` JSON. |
| `parseCodexConfigDefaults(raw)` | Parse top-level Codex CLI config defaults. |
| `reasoningOptionsForModel(models, selectedModel?)` | Resolve Codex reasoning options. |
| `getPluginProviderDiagnostics()` | Return plugin loading diagnostics. |
| `providerPluginTrustStatus(providerId)` | Return plugin trust status. |

Important types:

- `AiProviderId`
- `ProviderRunRequest`
- `ProviderRunResult`
- `ProviderCapabilities`
- `CodexRunRequest`
- `CodexRunResult`

## Reports and Output

| Export | Purpose |
|---|---|
| `prepareRunDirectory(options)` | Create a new run directory. |
| `useExistingRunDirectory(path)` | Use an existing run directory. |
| `validateReportRoot(path, projectRoot?)` | Validate report output root safety. |
| `writeMeta(runDir, meta)` | Write run metadata. |
| `createRunId()` | Create a filesystem-safe run id. |
| `writeFindingExports(runDir, formats, findings)` | Write SARIF, HTML, JSONL, or GitHub exports. |
| `renderGithubStepSummary(summary)` | Render GitHub step summary text. |
| `renderPrComment(review)` | Render PR comment body. |
| `reviewRunDirectory(runDir, options?)` | Review a completed run. |
| `renderRunReview(review)` | Render run review text. |
| `runReviewCommand(options)` | Execute review command. |
| `runPrCommentCommand(options)` | Execute PR comment command. |

Important types:

- `ReportExportFormat`
- `PromptManifest`
- `PromptManifestPhase`
- `StructuredPhaseReport`
- `StructuredRoadmapProposal`

## Findings

| Export | Purpose |
|---|---|
| `extractFindings(markdown)` | Extract active findings. |
| `extractFindingsWithSource(markdown, source)` | Extract findings with source metadata. |
| `extractSchemaFindings(markdown, source)` | Extract schema findings. |
| `findingCountsBySeverity(findings)` | Count findings by severity. |
| `findingSignature(finding)` | Build stable finding signature. |
| `stableFindingId(finding)` | Build stable finding id. |
| `stableId(input)` | Build stable hash id. |
| `evidenceReferencesForFinding(finding)` | Normalize finding evidence references. |
| `validateFindingEvidence(finding, options)` | Validate one finding's evidence. |
| `validateFindingsEvidence(findings, options)` | Validate evidence for many findings. |
| `loadStoredFindings(outDir?)` | Load persisted finding state. |
| `writeFindingState(findings, outDir?)` | Write finding state. |
| `findingStateDirectory(outDir?)` | Resolve finding state directory. |
| `runListFindingsCommand(options)` | Execute findings command. |
| `runNextFindingCommand(options)` | Execute next command. |
| `runShowFindingCommand(options)` | Execute show command. |
| `runTriageFindingCommand(options)` | Execute triage command. |
| `runRevalidateFindingCommand(options)` | Execute local revalidation. |
| `runProviderRevalidateFindingCommand(options, context?)` | Execute provider revalidation. |
| `runCreateIssueCommand(options)` | Execute GitHub issue workflow. |
| `runFindingsMenu(options)` | Open findings TUI. |

Important types:

- `StructuredFinding`
- `FindingStatus`
- `FindingEvidenceReference`
- `FindingEvidenceValidation`
- `FindingHistoryEntry`

## Baseline and Patches

| Export | Purpose |
|---|---|
| `applyBaselineToFindings(findings, baseline)` | Apply suppressions. |
| `baselineSummary(baseline)` | Render baseline summary. |
| `runBaselineCommand(options)` | Execute baseline command. |
| `loadPatchAttempts(outDir?)` | Load patch attempts. |
| `patchAttemptsDirectory(outDir?)` | Resolve patch attempt directory. |
| `runFixFindingCommand(options, context?)` | Execute fix workflow. |
| `runPatchesCommand(options)` | Execute patches command. |
| `runOpenPrCommand(options)` | Execute open-pr command. |

Important types:

- `PatchAttempt`
- `PatchAttemptStatus`

## Project Map, Features, and Workspaces

| Export | Purpose |
|---|---|
| `scanProject(root, options?)` | Scan project files. |
| `createProjectInventory(scan, options?)` | Render inventory. |
| `createProjectMap(root, options?)` | Build project map. |
| `initializeProjectMap(root, options?)` | Persist project map. |
| `loadProjectMap(root, options?)` | Load project map. |
| `projectMapPath(root, outDir?)` | Resolve project map path. |
| `checkProjectMapFreshness(root, map, options?)` | Check stale map state. |
| `renderProjectPlan(map, options?)` | Render parallel plan. |
| `createParallelExecutionMeta(map, options?)` | Build parallel metadata. |
| `assignFindingsToFeatures(findings, features)` | Link findings to features. |
| `syncFeatureRecords(root, map, findings?)` | Sync durable feature records. |
| `loadFeatureRecords(root, outDir?)` | Load features. |
| `updateFeatureRecordsFromFindings(root, findings, options?)` | Update features from findings. |
| `cleanFeatureLocks(root, options?)` | Clean locks. |
| `featureStateDirectory(root, outDir?)` | Resolve feature directory. |
| `featureLocksDirectory(root, outDir?)` | Resolve lock directory. |
| `runInitCommand(options)` | Execute project initialization command. |
| `runPlanCommand(options)` | Execute project plan command. |
| `runCleanLocksCommand(options)` | Execute lock cleanup command. |
| `detectWorkspaces(root)` | Detect workspaces. |
| `resolveWorkspaceScope(workspaces, selector)` | Resolve workspace selector. |
| `workspaceIncludes(workspace)` | Convert workspace to include patterns. |

Important types:

- `ProjectMap`
- `ProjectArea`
- `ProjectFileSummary`
- `SemanticFeature`
- `FeatureRecord`
- `FeatureStatus`
- `ParallelExecutionMeta`
- `WorkShard`
- `WorkspaceDetectionResult`
- `WorkspaceInfo`
- `DiffScope`
- `DiffFileStatus`

## Compare

| Export | Purpose |
|---|---|
| `buildRunComparison(oldRun, newRun, projectRoot?)` | Build comparison object. |
| `renderRunComparison(comparison)` | Render Markdown comparison. |
| `renderRunComparisonHtml(comparison)` | Render HTML comparison. |
| `runCompareCommand(oldRun, newRun, projectRoot, options?)` | Execute compare command. |
| `compareHasRegression(oldRun, newRun)` | Return whether compare detects a regression. |

Important type:

- `CompareFormat`

## Evidence, Quality, Prompt, and Schemas

| Export | Purpose |
|---|---|
| `collectEvidence(root, options)` | Collect evidence pack. |
| `hasFailedChecks(evidence)` | Detect failed check commands. |
| `renderEvidenceMarkdown(evidence)` | Render evidence pack Markdown. |
| `projectScanFingerprint(scan, options?)` | Build scan cache fingerprint input. |
| `updateAuditCache(root, scan, context?)` | Update incremental audit cache metadata. |
| `createPromptManifest(input)` | Build prompt manifest. |
| `allowedEvidencePathsFromPromptManifest(manifest)` | Resolve allowed evidence paths. |
| `PROMPT_CONTEXT_VERSION` | Prompt-context version used by cache and metadata. |
| `QUALITY_GATES_VERSION` | Quality-gate version used by cache and metadata. |
| `validateReportQuality(phaseId, markdown, context?)` | Validate report quality. |
| `PHASE_SCHEMA_VERSION` | Structured phase schema version. |
| `extractStructuredPhaseReport(markdown, source)` | Extract normalized phase schema. |
| `hasStructuredPhaseSchema(markdown)` | Check whether Markdown contains a structured phase schema. |
| `phaseReportJsonSchema(phaseId)` | Provider JSON schema for phase reports. |
| `riskReportJsonSchema()` | Provider JSON schema for risk findings. |
| `structuredPromptForPhase(phaseId)` | Schema instruction text for a phase. |
| `renderStructuredProviderOutput(output)` | Render provider structured output to Markdown. |

Important types:

- `EvidencePack`
- `EvidenceCommandResult`
- `StructuredPhaseReport`
- `AuditCacheMeta`

## Settings and State

| Export | Purpose |
|---|---|
| `loadSettings(path?)` | Load settings. |
| `saveSettings(settings, path?)` | Save settings. |
| `sanitizeSettings(settings)` | Validate and normalize settings. |
| `applySettingsToDefaults(defaults, settings)` | Apply settings to audit defaults. |
| `runSettingsGetCommand(options)` | Execute settings get. |
| `runSettingsSetCommand(options)` | Execute settings set. |
| `runSettingsResetCommand(options)` | Execute settings reset. |
| `SETTING_DEFINITIONS` | Supported settings metadata. |
| `SETTING_KEYS` | Supported setting keys. |
| `normalizeSettingKey(value)` | Validate setting key. |
| `parseSettingValue(key, value)` | Parse setting value. |
| `renderSettingsMenuFrame(settings, options?)` | Render settings TUI frame for tests/tools. |
| `renderSettingsTerminalFrame(frame)` | Render terminal frame with line clearing. |
| `summarizeSettings(settings)` | Return settings summary lines. |
| `listReportRuns(projectRoot, outDir)` | List completed report runs for the report browser. |
| `runReportsMenu(options)` | Open the report browser TUI. |
| `renderReportsMenuFrame(runs, state, options)` | Render the report browser TUI frame for tests/tools. |
| `renderFindingsMenuFrame(findings, state, options)` | Render the findings TUI frame for tests/tools. |
| `renderTuiListFrame(options)` | Render a shared TUI list frame. |
| `renderTuiTextFrame(options)` | Render a shared TUI text viewer frame. |
| `wrappedLineCount(lines, columns)` | Count wrapped terminal rows for shared TUI viewers. |
| `readStateFile(path, options)` | Read versioned state. |
| `writeStateFileAtomic(path, kind, schemaVersion, data)` | Write versioned state atomically. |
| `writeJsonAtomic(path, data)` | Write JSON atomically. |

## Utilities

| Export | Purpose |
|---|---|
| `runDoctorCommand(options)` | Execute doctor command. |
| `runCiInitCommand(options)` | Execute CI init command. |
| `runProvidersCommand(options)` | Execute providers command. |
| `AUDIT_PROFILES` | Built-in profile definitions. |
| `applyAuditProfile(options, profile)` | Apply a profile to options. |
| `runProfilesCommand(json?)` | Execute profiles command. |
| `collectDiffScope(root, ref)` | Collect changed-file scope. |
| `createIgnoreMatcher(patterns)` | Build ignore matcher. |
| `globToRegExp(glob)` | Convert glob to RegExp. |
| `matchesPattern(path, patterns)` | Check patterns. |
| `createSensitiveTextMasker()` | Create streaming secret masker. |
| `maskSensitiveText(value)` | Mask sensitive text. |
| `maskSensitiveValue(key, value)` | Mask one value. |
| `maskObject(object)` | Mask object fields. |
| `isSensitiveKey(key)` | Detect sensitive key names. |
