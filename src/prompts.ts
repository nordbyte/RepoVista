export interface PromptContext {
  language: string;
  projectRoot: string;
  reportFolderName: string;
  inventoryMarkdown: string;
  previousReports: Record<string, string>;
  since?: {
    ref: string;
    changedFiles: string[];
    fileStatuses?: Array<{
      path: string;
      status: string;
      previousPath?: string;
    }>;
  };
  features?: Array<{
    id: string;
    title: string;
    kind: string;
    paths: string[];
    ownedFiles: string[];
    tests: string[];
    trustBoundaries: string[];
  }>;
  reviewMode?: "default" | "deslopify" | "security" | "test-gaps";
  additionalGuidance?: string;
}

export interface PhaseDefinition {
  id: string;
  title: string;
  reportFile: string;
  dependencies: string[];
  previousReports?: string[];
  optionalPreviousReports?: string[];
  buildPrompt(context: PromptContext): string;
}

export const PROMPT_CONTEXT_VERSION = 2;

const CONTEXT_LIMIT = 18000;
const PREVIOUS_REPORT_CONTEXT_LIMIT = 14000;

export const ANALYSIS_PHASES: PhaseDefinition[] = [
  {
    id: "architecture",
    title: "Architecture Analysis",
    reportFile: "01-architecture-report.md",
    dependencies: [],
    buildPrompt: buildArchitecturePrompt
  },
  {
    id: "code-quality",
    title: "Code Quality Analysis",
    reportFile: "02-code-quality-report.md",
    dependencies: ["architecture"],
    previousReports: ["01-architecture-report.md"],
    buildPrompt: buildCodeQualityPrompt
  },
  {
    id: "risk-and-bug",
    title: "Risk, Bug, and Security Analysis",
    reportFile: "03-risk-and-bug-report.md",
    dependencies: ["architecture"],
    previousReports: ["01-architecture-report.md"],
    optionalPreviousReports: ["02-code-quality-report.md"],
    buildPrompt: buildRiskPrompt
  },
  {
    id: "feature-roadmap",
    title: "Feature and Improvement Roadmap",
    reportFile: "04-feature-roadmap.md",
    dependencies: ["code-quality", "risk-and-bug"],
    previousReports: [
      "01-architecture-report.md",
      "02-code-quality-report.md",
      "03-risk-and-bug-report.md"
    ],
    buildPrompt: buildRoadmapPrompt
  },
  {
    id: "summary",
    title: "Executive Summary",
    reportFile: "index.md",
    dependencies: ["code-quality", "risk-and-bug", "feature-roadmap"],
    previousReports: [
      "01-architecture-report.md",
      "02-code-quality-report.md",
      "03-risk-and-bug-report.md",
      "04-feature-roadmap.md"
    ],
    buildPrompt: buildSummaryPrompt
  }
];

function baseInstructions(context: PromptContext, role: string): string {
  return `You are a ${role}. Analyze the repository in the current working directory: ${context.projectRoot}.

Safety and working rules:
- Work strictly read-only. Do not modify files in the target project.
- Ignore the RepoVista report directory \`${context.reportFolderName}\` and all old RepoVista reports completely as project code.
- Do not run destructive commands.
- Do not enable unnecessary network access.
- Name concrete paths, files, modules, or configuration when possible.
- Clearly mark uncertainty as a hypothesis or open question.
- Do not invent facts. If something is not supported by evidence, say so.
- Prioritize findings and recommendations clearly.
- Ground every important claim in concrete evidence from files, configuration, tests, local checks, or Git metadata.
- RepoVista already collected the Evidence Pack shown below. Treat Evidence Pack check results as completed checks. Do not write that tests or checks were not run when the Evidence Pack ran them; if you ran no extra provider-side commands, write "No additional provider-side commands were run beyond the Evidence Pack."
- Keep Evidence Pack results separate from your provider-side read-only context. The Evidence Pack is tool-collected evidence; your own session remains read-only.
- Use the semantic feature map and optional diff scope below to target the review. If a diff scope exists, prioritize changed files while still mentioning important cross-file dependencies.
- For recommendations, include affected paths/modules, impact, confidence, and an implementation hint.
- Avoid generic best-practice filler that is not tied to this repository.
- Write the final report in ${context.language}.
- Return only the Markdown report as the final answer.

Local project inventory from RepoVista:

${clip(context.inventoryMarkdown)}

${renderDiffScope(context)}

${renderFeatureMap(context)}

${renderAdditionalGuidance(context)}
`;
}

function buildArchitecturePrompt(context: PromptContext): string {
  return `${baseInstructions(context, "Staff Software Architect")}

Task: Create a detailed architecture report.

Analyze:
- The purpose and likely main function of the application.
- Tech stack.
- Central modules, components, services, and APIs.
- Data flows and control flows.
- Configuration structure.
- Build, test, and deployment structure.
- Architecture patterns.
- Coupling, cohesion, and responsibilities.
- Especially important files.
- Entry points for new developers.

The report must contain these sections:
1. Executive Summary
2. Project Purpose
3. Tech Stack
4. Module and Component Overview
5. Data Flow and Control Flow
6. Important Files and Their Role
7. External Dependencies and Integrations
8. Architecture Strengths
9. Architecture Weaknesses
10. Maintainability and Scaling Risks
11. Recommendations
12. Open Questions and Uncertainties

${structuredSchemaInstructions("architecture")}
`;
}

function buildCodeQualityPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "Senior Code Reviewer")}

Previous architecture findings:

${renderPrevious(context, ["01-architecture-report.md"], "code-quality")}

Task: Evaluate code quality, strengths, weaknesses, and maintainability from a senior review perspective.

Analyze:
- Readability, structure, and naming.
- Error handling and testability.
- Modularity, duplication, and unnecessary complexity.
- Dependency usage, API design, and typing.
- Configuration quality and maintainability.

The report must contain these sections:
1. Executive Summary
2. Biggest Strengths
3. Biggest Weaknesses
4. Code Smells
5. Maintainability Problems
6. Test Coverage and Test Strategy
7. Technical Debt
8. Prioritized Recommendations
9. Quick Wins
10. Medium-Term Refactorings
11. Larger Architecture Measures

For relevant weaknesses, name the file or path, evidence, problem, impact, recommendation, priority, confidence, and implementation hint.

${structuredSchemaInstructions("code-quality")}
`;
}

function buildRiskPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "defensive application-security and bug-audit reviewer")}

Previous findings:

${renderPrevious(context, ["01-architecture-report.md"], "risk-and-bug")}
${renderOptionalPrevious(context, ["02-code-quality-report.md"], "risk-and-bug")}

Task: Identify potential bugs, security risks, and robust failure modes. Stay defensive; do not provide exploit instructions against real external targets.

Analyze:
- Input validation, authentication, and authorization.
- Secrets and configuration.
- Unsafe file and path handling.
- Injection risks.
- XSS, CSRF, SSRF, and similar risks where relevant.
- Unsafe dependency usage.
- Race conditions, faulty async logic, and error-handling paths.
- Data-loss risks.
- Logging of sensitive data.
- Missing tests for critical paths.
- Incorrect assumptions in business logic.

${reviewModeInstructions(context.reviewMode ?? "default")}

The report must contain these sections:
1. Executive Summary
2. Critical Findings
3. High Findings
4. Medium Findings
5. Low Findings
6. Potential Bugs
7. Security Risks
8. Missing Tests
9. Recommended Next Steps

For each finding in the Markdown sections, use this field format:
- Title: <short title>
- Severity: Critical | High | Medium | Low
- Category: <bug, security, reliability, maintainability, data loss, etc.>
- Affected paths: <comma-separated concrete files/modules>
- Evidence: <specific code/config/test/local-check evidence>
- Problem rationale: <why this is a real risk>
- Recommended fix: <concrete fix proposal>
- Reproduction: <minimal way to observe or reason about the failure; use "not required" only when inappropriate>
- Suggested regression test: <specific automated test to add>
- Minimum fix scope: <smallest code area that must change>
- Estimated effort: <small, medium, large>
- Confidence: High | Medium | Low

Also include a RepoVista findings JSON block near the end of the report. This JSON schema is RepoVista's primary structured findings source, so keep it valid JSON and make it match the Markdown findings exactly. Put it between the sentinel comments below, not in a Markdown code fence. This prevents evidence quotes containing code fences from breaking parsing:

<!-- repovista-findings:start -->
{
  "schemaVersion": 1,
  "phaseId": "risk-and-bug",
  "findings": [
    {
      "title": "<short title>",
      "severity": "critical | high | medium | low",
      "category": "<bug, security, reliability, maintainability, data loss, etc.>",
      "status": "open",
      "signature": "<stable human-readable signature such as severity|category|primary-path|title>",
      "affectedPaths": ["src/example.ts"],
      "evidence": "<specific code/config/test/local-check evidence>",
      "evidenceReferences": [
        {
          "path": "src/example.ts",
          "startLine": 1,
          "endLine": 12,
          "quote": "<short exact snippet when useful>",
          "symbol": "<function/class/config key when useful>"
        }
      ],
      "problemRationale": "<why this is a real risk>",
      "recommendedFix": "<concrete fix proposal>",
      "reproduction": "<minimal reproduction or reasoning path>",
      "suggestedRegressionTest": "<specific automated regression test>",
      "minimumFixScope": "<smallest code area to change>",
      "estimatedEffort": "small | medium | large",
      "confidence": "high | medium | low",
      "findingType": "atomic",
      "parentId": "<optional parent finding id>",
      "parentTitle": "<optional parent theme title>",
      "childFindings": []
    }
  ]
}
<!-- repovista-findings:end -->

Use parent/child findings when a broad theme contains multiple independent fixes: the parent should have findingType "theme" and childFindings should hold atomic findings with their own evidence, reproduction, regression test, minimum fix scope, and severity.

If there are no findings, use '"findings": []' and still say explicitly in each severity section that no findings were detected. Mark uncertain findings explicitly as hypotheses.

${structuredSchemaInstructions("risk-and-bug")}
`;
}

function buildRoadmapPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "product-minded Senior Engineer")}

Previous findings:

${renderPrevious(context, [
    "01-architecture-report.md",
    "02-code-quality-report.md",
    "03-risk-and-bug-report.md"
  ], "feature-roadmap")}

Task: Derive a concrete feature and improvement roadmap from the code, architecture, and previous reports.

Analyze:
- Which existing features should be improved.
- Which features are likely missing.
- Which improvements would have the highest value.
- Which features fit the current architecture.
- Which features require refactoring first.
- Which technical improvements would improve stability, security, or developer experience.

The report must contain these sections:
1. Executive Summary
2. Useful Improvements to Existing Features
3. Useful New Features
4. Missing Technical Foundations
5. Developer Experience Improvements
6. Security and Reliability Improvements
7. Prioritized Roadmap

Return at least 6 concrete roadmap proposals unless the repository is too small to justify that many; if fewer are appropriate, state why. For each proposal, include title, description, evidence/rationale from code or architecture, benefit, effort, risk, affected files or modules, possible implementation steps, priority, and confidence. Avoid generic proposals.

${structuredSchemaInstructions("feature-roadmap")}
`;
}

function buildSummaryPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "technical editor and tech lead")}

Detail reports:

${renderPrevious(context, [
    "01-architecture-report.md",
    "02-code-quality-report.md",
    "03-risk-and-bug-report.md",
    "04-feature-roadmap.md"
  ], "summary")}

Task: Create the final overview as the entry-point \`index.md\`.

The report must contain these sections:
1. Short Conclusion
2. What the Project Does
3. Architecture in a Few Precise Paragraphs
4. Top Strengths
5. Top Weaknesses
6. Most Critical Risks
7. Most Likely Bugs
8. Best Quick Wins
9. Most Important Feature Opportunities
10. Recommended Order of Next Steps
11. Links to the Detail Reports

Link the detail reports with these relative Markdown links:
- [Project Inventory](00-inventory.md)
- [Architecture Report](01-architecture-report.md)
- [Code Quality Report](02-code-quality-report.md)
- [Risk, Bug, and Security Report](03-risk-and-bug-report.md)
- [Feature Roadmap](04-feature-roadmap.md)

${structuredSchemaInstructions("summary")}
`;
}

function structuredSchemaInstructions(phaseId: string): string {
  if (phaseId === "feature-roadmap") {
    return `Also include a fenced JSON block near the end of the report. This JSON is RepoVista's primary structured roadmap source:

\`\`\`json
{
  "schemaVersion": 1,
  "phaseId": "feature-roadmap",
  "executiveSummary": "<short summary>",
  "keyPoints": ["<important observed point>"],
  "evidenceReferences": ["src/example.ts"],
  "recommendations": ["<cross-cutting recommendation>"],
  "proposals": [
    {
      "title": "<proposal title>",
      "description": "<what to build or improve>",
      "evidence": ["<specific file/config/report evidence>"],
      "benefit": "<user or engineering value>",
      "effort": "small | medium | large",
      "risk": "<main delivery or product risk>",
      "affected": ["src/example.ts"],
      "steps": ["<first implementation step>"],
      "priority": "P0 | P1 | P2 | P3",
      "confidence": "high | medium | low"
    }
  ]
}
\`\`\``;
  }
  if (phaseId === "risk-and-bug") {
    return `Also include this second JSON block for phase-level structure between sentinel comments:

<!-- repovista-phase:start -->
{
  "schemaVersion": 1,
  "phaseId": "risk-and-bug",
  "executiveSummary": "<short summary>",
  "keyPoints": ["<important risk pattern>"],
  "evidenceReferences": ["src/example.ts"],
  "recommendations": ["<highest-value fix>"]
}
<!-- repovista-phase:end -->`;
  }
  return `Also include a fenced JSON block near the end of the report. This JSON is RepoVista's primary structured phase source:

\`\`\`json
{
  "schemaVersion": 1,
  "phaseId": "${phaseId}",
  "executiveSummary": "<short summary>",
  "keyPoints": ["<important observed point>"],
  "evidenceReferences": ["src/example.ts"],
  "recommendations": ["<actionable recommendation>"]
}
\`\`\``;
}

function renderPrevious(context: PromptContext, reportFiles: string[], targetPhase: string): string {
  const sections = reportFiles.map((fileName) => {
    const content = context.previousReports[fileName];
    if (!content) {
      return `## ${fileName}\n\nNot yet available or failed.`;
    }
    return `## ${fileName}\n\n${summarizePreviousReport(fileName, content, targetPhase)}`;
  });
  return sections.join("\n\n");
}

function renderOptionalPrevious(context: PromptContext, reportFiles: string[], targetPhase: string): string {
  const availableReports = reportFiles.filter((fileName) => Boolean(context.previousReports[fileName]));
  if (!availableReports.length) {
    return "";
  }
  return `\nOptional previous findings already available:\n\n${renderPrevious(context, availableReports, targetPhase)}`;
}

function summarizePreviousReport(fileName: string, content: string, targetPhase: string): string {
  const excerpts = [
    ...selectedSections(content, targetPhase),
    ...structuredBlocks(content),
    evidenceLines(content, targetPhase)
  ].filter(Boolean);
  const summary = excerpts.length
    ? excerpts.join("\n\n")
    : fallbackEvidenceSummary(content);
  return clipPreviousSummary(`RepoVista selected evidence-oriented excerpts from ${fileName} for ${targetPhase}:\n\n${summary}`);
}

function selectedSections(content: string, targetPhase: string): string[] {
  const sections = markdownSections(content);
  const wanted = sectionKeywords(targetPhase);
  return sections
    .map((section) => ({
      section,
      score: wanted.reduce((sum, keyword) => sum + (section.heading.toLowerCase().includes(keyword) ? 3 : section.body.toLowerCase().includes(keyword) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.section.index - right.section.index)
    .slice(0, 5)
    .map((item) => `${item.section.heading}\n\n${clipSection(item.section.body, 2600)}`);
}

function markdownSections(content: string): Array<{ index: number; heading: string; body: string }> {
  const lines = content.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => ({ line, index, match: /^(#{1,6}\s+.+?)\s*$/.exec(line) }))
    .filter((item): item is { line: string; index: number; match: RegExpExecArray } => Boolean(item.match));
  if (!headingIndexes.length) {
    return [{ index: 0, heading: "### Report excerpt", body: content }];
  }
  return headingIndexes.map((heading, index) => {
    const next = headingIndexes[index + 1]?.index ?? lines.length;
    return {
      index: heading.index,
      heading: heading.match[1],
      body: lines.slice(heading.index + 1, next).join("\n").trim()
    };
  });
}

function sectionKeywords(targetPhase: string): string[] {
  if (targetPhase === "code-quality") {
    return ["executive summary", "weakness", "maintainability", "recommendation", "test", "technical debt", "important files"];
  }
  if (targetPhase === "risk-and-bug") {
    return ["finding", "risk", "security", "bug", "missing test", "weakness", "evidence", "recommendation"];
  }
  if (targetPhase === "feature-roadmap") {
    return ["recommendation", "quick win", "roadmap", "weakness", "risk", "missing", "improvement", "feature"];
  }
  if (targetPhase === "summary") {
    return ["executive summary", "strength", "weakness", "risk", "recommendation", "roadmap", "conclusion"];
  }
  return ["executive summary", "recommendation", "evidence"];
}

function structuredBlocks(content: string): string[] {
  const blocks: string[] = [];
  for (const pattern of [
    /<!--\s*repovista-findings:start\s*-->([\s\S]*?)<!--\s*repovista-findings:end\s*-->/i,
    /<!--\s*repovista-phase:start\s*-->([\s\S]*?)<!--\s*repovista-phase:end\s*-->/i
  ]) {
    const match = pattern.exec(content);
    if (match?.[1]?.trim()) {
      blocks.push(`### Structured RepoVista schema excerpt\n\n${clipSection(match[1].trim(), 5200)}`);
    }
  }
  const jsonBlocks = Array.from(content.matchAll(/```json\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => /"schemaVersion"|"phaseId"|"findings"|"proposals"/.test(value))
    .slice(0, 2)
    .map((value) => `### Structured JSON excerpt\n\n${clipSection(value, 3600)}`);
  return [...blocks, ...jsonBlocks].slice(0, 3);
}

function evidenceLines(content: string, targetPhase: string): string {
  const wanted = sectionKeywords(targetPhase);
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => hasPathEvidence(line) || /^[-*]\s*(Evidence|Affected paths|Recommended fix|Recommendation|Suggested regression test|Minimum fix scope|Reproduction|Priority|Confidence)\s*:/i.test(line))
    .filter((line) => wanted.some((keyword) => line.toLowerCase().includes(keyword)) || hasPathEvidence(line))
    .slice(0, 28);
  return lines.length ? `### Evidence lines\n\n${lines.map((line) => `- ${line.replace(/^[-*]\s*/, "")}`).join("\n")}` : "";
}

function fallbackEvidenceSummary(content: string): string {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => hasPathEvidence(part) || /recommend|risk|finding|evidence|test|roadmap/i.test(part))
    .slice(0, 6)
    .join("\n\n");
  return paragraphs || clipSection(content, 4000);
}

function hasPathEvidence(value: string): boolean {
  return /(?:^|[\s`])((?:\.?\/)?(?:src|test|tests|lib|app|scripts|docs|\.github)[/\w.-]*|(?:package(?:-lock)?\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod))(?=$|[\s`)\],.;:])/m.test(value);
}

function clipSection(content: string, limit: number): string {
  if (content.length <= limit) {
    return content;
  }
  return `${content.slice(0, Math.floor(limit * 0.75))}

... RepoVista omitted lower-priority lines from this section ...

${content.slice(content.length - Math.floor(limit * 0.25))}`;
}

function clipPreviousSummary(content: string): string {
  if (content.length <= PREVIOUS_REPORT_CONTEXT_LIMIT) {
    return content;
  }
  return `${content.slice(0, PREVIOUS_REPORT_CONTEXT_LIMIT)}

... RepoVista omitted remaining previous-report excerpts after evidence prioritization ...`;
}

function renderDiffScope(context: PromptContext): string {
  if (!context.since) {
    return "";
  }
  const changedFiles = context.since.fileStatuses?.length
    ? context.since.fileStatuses.map((file) => `- ${file.status}: ${file.previousPath ? `${file.previousPath} -> ` : ""}${file.path}`).join("\n")
    : context.since.changedFiles.length
      ? context.since.changedFiles.map((file) => `- ${file}`).join("\n")
    : "- No changed files detected.";
  return `Diff scope from RepoVista:

Base ref: ${context.since.ref}
Changed files:
${changedFiles}
`;
}

function renderFeatureMap(context: PromptContext): string {
  if (!context.features?.length) {
    return "";
  }
  const featureLines = context.features.slice(0, 16).map((feature) => [
    `- ${feature.id}: ${feature.title} (${feature.kind})`,
    `  paths: ${feature.paths.join(", ") || "n/a"}`,
    `  owned files: ${feature.ownedFiles.slice(0, 8).join(", ") || "n/a"}`,
    `  tests: ${feature.tests.slice(0, 6).join(", ") || "n/a"}`,
    `  trust boundaries: ${feature.trustBoundaries.join(", ") || "n/a"}`
  ].join("\n"));
  return `Semantic feature map from RepoVista:

${featureLines.join("\n")}
`;
}

function renderAdditionalGuidance(context: PromptContext): string {
  if (!context.additionalGuidance?.trim()) {
    return "";
  }
  return `Additional reviewer guidance from --prompt-file:

${clip(context.additionalGuidance.trim())}
`;
}

function reviewModeInstructions(mode: NonNullable<PromptContext["reviewMode"]>): string {
  if (mode === "default") {
    return "";
  }
  if (mode === "deslopify") {
    return `Review mode: deslopify.
- Report only simplification findings in maintainability or performance.
- Focus on locally provable accidental complexity, duplicated behavior, dead compatibility paths, wrapper layers, generated-looking boilerplate, broad defensive code without a real trust boundary, and tests that preserve implementation details.
- Prefer deletion, consolidation, or reuse of existing local patterns over new abstractions.
- Do not report style taste, broad architecture opinions, or correctness/security issues unless the root cause is accidental complexity and the minimum fix is simplification.`;
  }
  if (mode === "security") {
    return `Review mode: security.
- Prioritize authentication, authorization, secrets, unsafe file/path handling, command execution, dependency supply-chain, injection, XSS/CSRF/SSRF, release credential, and sensitive logging risks.
- Do not include non-security maintainability findings unless they directly create a security or data-integrity risk.`;
  }
  return `Review mode: test-gaps.
- Prioritize missing or weak automated coverage for behavior that is security-sensitive, release-critical, data-loss-prone, or central to user workflows.
- Every finding should name the expected regression test and the smallest code path it should exercise.`;
}

function clip(content: string): string {
  if (content.length <= CONTEXT_LIMIT) {
    return content;
  }
  const headLength = Math.floor(CONTEXT_LIMIT * 0.6);
  const tailLength = CONTEXT_LIMIT - headLength;
  return `${content.slice(0, headLength)}

... RepoVista context truncated; preserving the end of the report below ...

${content.slice(content.length - tailLength)}`;
}
