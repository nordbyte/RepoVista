export interface ReportQualityResult {
  passed: boolean;
  warnings: string[];
}

const REQUIRED_SECTIONS: Record<string, string[]> = {
  architecture: [
    "Executive Summary",
    "Project Purpose",
    "Tech Stack",
    "Module and Component Overview",
    "Data Flow and Control Flow",
    "Recommendations"
  ],
  "code-quality": [
    "Executive Summary",
    "Biggest Strengths",
    "Biggest Weaknesses",
    "Test Coverage and Test Strategy",
    "Prioritized Recommendations"
  ],
  "risk-and-bug": [
    "Executive Summary",
    "Critical Findings",
    "High Findings",
    "Medium Findings",
    "Low Findings",
    "Recommended Next Steps"
  ],
  "feature-roadmap": [
    "Executive Summary",
    "Useful Improvements to Existing Features",
    "Useful New Features",
    "Prioritized Roadmap"
  ],
  summary: [
    "Short Conclusion",
    "What the Project Does",
    "Top Strengths",
    "Top Weaknesses",
    "Recommended Order of Next Steps"
  ]
};

export function validateReportQuality(phaseId: string, markdown: string): ReportQualityResult {
  const warnings: string[] = [];
  const trimmed = markdown.trim();
  if (!trimmed) {
    return {
      passed: false,
      warnings: ["Report is empty."]
    };
  }

  const headingText = collectHeadingText(markdown);
  const requiredSections = REQUIRED_SECTIONS[phaseId] ?? [];
  for (const section of requiredSections) {
    if (!containsHeading(headingText, section)) {
      warnings.push(`Missing expected section: ${section}.`);
    }
  }

  if (phaseId !== "summary" && !hasPathEvidence(markdown)) {
    warnings.push("Report does not contain concrete file or path evidence.");
  }

  if (phaseId === "risk-and-bug" && !/severity\s*:/i.test(markdown) && !/no\s+(critical|high|medium|low)\s+findings/i.test(markdown)) {
    warnings.push("Risk report does not use severity fields or explicit no-finding statements.");
  }

  if (/as an ai|i cannot inspect|i don't have access/i.test(markdown)) {
    warnings.push("Report contains language suggesting the repository was not inspected.");
  }

  return {
    passed: warnings.length === 0,
    warnings
  };
}

function collectHeadingText(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(normalizeHeading);
}

function containsHeading(headings: string[], expected: string): boolean {
  const normalized = normalizeHeading(expected);
  return headings.some((heading) => heading === normalized || heading.includes(normalized));
}

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_()[\]:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPathEvidence(markdown: string): boolean {
  return /(?:^|[\s`])(?:\.?\/)?(?:src|test|tests|lib|app|scripts|docs|\.github|package\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod)[/\w.-]*/m.test(markdown);
}
