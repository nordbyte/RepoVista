export interface PromptContext {
  language: string;
  projectRoot: string;
  reportFolderName: string;
  inventoryMarkdown: string;
  previousReports: Record<string, string>;
}

export interface PhaseDefinition {
  id: string;
  title: string;
  reportFile: string;
  buildPrompt(context: PromptContext): string;
}

const CONTEXT_LIMIT = 18000;

export const ANALYSIS_PHASES: PhaseDefinition[] = [
  {
    id: "architecture",
    title: "Architecture Analysis",
    reportFile: "01-architecture-report.md",
    buildPrompt: buildArchitecturePrompt
  },
  {
    id: "code-quality",
    title: "Code Quality Analysis",
    reportFile: "02-code-quality-report.md",
    buildPrompt: buildCodeQualityPrompt
  },
  {
    id: "risk-and-bug",
    title: "Risk, Bug, and Security Analysis",
    reportFile: "03-risk-and-bug-report.md",
    buildPrompt: buildRiskPrompt
  },
  {
    id: "feature-roadmap",
    title: "Feature and Improvement Roadmap",
    reportFile: "04-feature-roadmap.md",
    buildPrompt: buildRoadmapPrompt
  },
  {
    id: "summary",
    title: "Executive Summary",
    reportFile: "index.md",
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
- For recommendations, include affected paths/modules, impact, confidence, and an implementation hint.
- Avoid generic best-practice filler that is not tied to this repository.
- Write the final report in ${context.language}.
- Return only the Markdown report as the final answer.

Local project inventory from RepoVista:

${clip(context.inventoryMarkdown)}
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
`;
}

function buildCodeQualityPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "Senior Code Reviewer")}

Previous architecture findings:

${renderPrevious(context, ["01-architecture-report.md"])}

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
`;
}

function buildRiskPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "defensive application-security and bug-audit reviewer")}

Previous findings:

${renderPrevious(context, ["01-architecture-report.md", "02-code-quality-report.md"])}

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
- Estimated effort: <small, medium, large>
- Confidence: High | Medium | Low

Also include a fenced JSON block near the end of the report. This JSON schema is RepoVista's primary structured findings source, so keep it valid JSON and make it match the Markdown findings exactly:

\`\`\`json
{
  "schemaVersion": 1,
  "findings": [
    {
      "title": "<short title>",
      "severity": "critical | high | medium | low",
      "category": "<bug, security, reliability, maintainability, data loss, etc.>",
      "affectedPaths": ["src/example.ts"],
      "evidence": "<specific code/config/test/local-check evidence>",
      "evidenceReferences": ["src/example.ts"],
      "problemRationale": "<why this is a real risk>",
      "recommendedFix": "<concrete fix proposal>",
      "estimatedEffort": "small | medium | large",
      "confidence": "high | medium | low"
    }
  ]
}
\`\`\`

If there are no findings, use '"findings": []' and still say explicitly in each severity section that no findings were detected. Mark uncertain findings explicitly as hypotheses.
`;
}

function buildRoadmapPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "product-minded Senior Engineer")}

Previous findings:

${renderPrevious(context, [
    "01-architecture-report.md",
    "02-code-quality-report.md",
    "03-risk-and-bug-report.md"
  ])}

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
  ])}

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
`;
}

function renderPrevious(context: PromptContext, reportFiles: string[]): string {
  const sections = reportFiles.map((fileName) => {
    const content = context.previousReports[fileName];
    if (!content) {
      return `## ${fileName}\n\nNot yet available or failed.`;
    }
    return `## ${fileName}\n\n${clip(content)}`;
  });
  return sections.join("\n\n");
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
