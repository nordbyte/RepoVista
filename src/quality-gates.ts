import { extractFindingsWithSource } from "./findings.js";
import { extractStructuredPhaseReport } from "./phase-schema.js";

export const QUALITY_GATES_VERSION = 2;

export interface ReportQualityResult {
  passed: boolean;
  warnings: string[];
  failures: string[];
  score: number;
  evidenceScore: number;
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

const MIN_PATH_EVIDENCE_BY_PHASE: Record<string, number> = {
  architecture: 5,
  "code-quality": 5,
  "risk-and-bug": 3,
  "feature-roadmap": 5
};

const MIN_ROADMAP_PROPOSALS = 6;
const ROADMAP_PROPOSAL_FIELDS = [
  "title",
  "description",
  "evidence",
  "benefit",
  "effort",
  "risk",
  "affected",
  "steps",
  "priority",
  "confidence"
];

export function validateReportQuality(phaseId: string, markdown: string): ReportQualityResult {
  const warnings: string[] = [];
  const failures: string[] = [];
  const trimmed = markdown.trim();
  if (!trimmed) {
    return {
      passed: false,
      warnings: ["Report is empty."],
      failures: ["Report is empty."],
      score: 0,
      evidenceScore: 0
    };
  }

  const headingText = collectHeadingText(markdown);
  const requiredSections = REQUIRED_SECTIONS[phaseId] ?? [];
  for (const section of requiredSections) {
    if (!containsHeading(headingText, section)) {
      failures.push(`Missing expected section: ${section}.`);
    }
  }

  if (phaseId !== "summary") {
    const pathEvidenceCount = countPathEvidence(markdown);
    const minimum = MIN_PATH_EVIDENCE_BY_PHASE[phaseId] ?? 1;
    if (pathEvidenceCount < minimum) {
      failures.push(`Report contains ${pathEvidenceCount} concrete path evidence reference(s); expected at least ${minimum}.`);
    }
  }

  if (phaseId === "risk-and-bug") {
    failures.push(...validateRiskFindings(markdown));
  }

  if (phaseId === "feature-roadmap") {
    failures.push(...validateRoadmapDepth(markdown));
  }

  if (/as an ai|i cannot inspect|i don't have access/i.test(markdown)) {
    warnings.push("Report contains language suggesting the repository was not inspected.");
  }

  if (/i\s+did\s+not\s+run\s+(?:the\s+)?(?:tests|checks)|tests?\s+were\s+not\s+run/i.test(markdown)) {
    warnings.push("Report claims tests or checks were not run instead of distinguishing provider context from the RepoVista evidence pack.");
  }

  const evidenceScore = scoreEvidenceQuality(phaseId, markdown);
  if (phaseId !== "summary" && evidenceScore < 45) {
    warnings.push(`Evidence quality score is low (${evidenceScore}/100); expected concrete paths, line ranges, quotes, tests or reproduction, and fix scope.`);
  }

  return {
    passed: warnings.length === 0 && failures.length === 0,
    warnings: [...failures, ...warnings],
    failures,
    score: qualityScore(markdown, warnings, failures, evidenceScore),
    evidenceScore
  };
}

function qualityScore(markdown: string, warnings: string[], failures: string[], evidenceScore: number): number {
  const evidenceBonus = Math.min(15, countPathEvidence(markdown));
  const lengthBonus = Math.min(10, Math.floor(markdown.trim().length / 2000));
  const evidenceQualityBonus = Math.round((evidenceScore - 50) / 5);
  const penalty = warnings.length * 6 + failures.length * 14;
  return Math.max(0, Math.min(100, 75 + evidenceBonus + lengthBonus + evidenceQualityBonus - penalty));
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

function validateRiskFindings(markdown: string): string[] {
  const warnings: string[] = [];
  const extraction = extractFindingsWithSource(markdown);
  if (!extraction.schemaFound) {
    warnings.push("Risk report does not include the RepoVista findings JSON schema.");
    if (!/severity\s*:/i.test(markdown) && !/no\s+(critical|high|medium|low)\s+findings/i.test(markdown)) {
      warnings.push("Risk report does not use severity fields or explicit no-finding statements.");
    }
    return warnings;
  }

  for (const warning of extraction.warnings) {
    warnings.push(`Findings schema warning: ${warning}`);
  }

  for (const finding of extraction.findings) {
    const label = finding.id || finding.title || "finding";
    if (!finding.title || /^unknown finding$/i.test(finding.title)) {
      warnings.push(`Schema finding ${label} is missing title.`);
    }
    if (finding.severity === "unknown") {
      warnings.push(`Schema finding ${label} is missing valid severity.`);
    }
    if (!finding.category) {
      warnings.push(`Schema finding ${label} is missing category.`);
    }
    if (!finding.paths.length) {
      warnings.push(`Schema finding ${label} is missing affectedPaths.`);
    }
    if (!finding.evidence) {
      warnings.push(`Schema finding ${label} is missing evidence.`);
    }
    const evidenceReferences = finding.evidenceDetails?.length
      ? finding.evidenceDetails
      : (finding.evidenceReferences ?? []).map((reference) => typeof reference === "string" ? { path: reference } : reference);
    if (!evidenceReferences.length) {
      warnings.push(`Schema finding ${label} is missing concrete evidenceReferences.`);
    }
    if (evidenceReferences.some((reference) => !reference.path)) {
      warnings.push(`Schema finding ${label} has an invalid evidence reference path.`);
    }
    if (evidenceReferences.some((reference) => !reference.startLine || !reference.endLine)) {
      warnings.push(`Schema finding ${label} has an evidence reference without startLine/endLine.`);
    }
    if (evidenceReferences.filter((reference) => reference.quote).length < Math.min(1, evidenceReferences.length)) {
      warnings.push(`Schema finding ${label} should include at least one exact evidence quote.`);
    }
    if (!finding.status) {
      warnings.push(`Schema finding ${label} is missing lifecycle status.`);
    }
    if (!finding.signature) {
      warnings.push(`Schema finding ${label} is missing a stable signature.`);
    }
    if (!finding.problemRationale) {
      warnings.push(`Schema finding ${label} is missing problemRationale.`);
    }
    if (!finding.recommendation) {
      warnings.push(`Schema finding ${label} is missing recommendedFix.`);
    }
    if (!finding.reproduction) {
      warnings.push(`Schema finding ${label} is missing reproduction.`);
    }
    if (!finding.suggestedRegressionTest) {
      warnings.push(`Schema finding ${label} is missing suggestedRegressionTest.`);
    }
    if (!finding.minimumFixScope) {
      warnings.push(`Schema finding ${label} is missing minimumFixScope.`);
    }
    if (!finding.estimatedEffort) {
      warnings.push(`Schema finding ${label} is missing estimatedEffort.`);
    }
    if (!finding.confidence) {
      warnings.push(`Schema finding ${label} is missing confidence.`);
    }
  }

  return warnings;
}

function validateRoadmapDepth(markdown: string): string[] {
  const warnings: string[] = [];
  const structured = extractStructuredPhaseReport(markdown, "feature-roadmap", "quality-gate");
  const proposalCount = structured.proposals?.length ?? countRoadmapProposals(markdown);
  if (proposalCount < MIN_ROADMAP_PROPOSALS) {
    warnings.push(`Roadmap contains ${proposalCount} proposal(s); expected at least ${MIN_ROADMAP_PROPOSALS}.`);
  }

  if (structured.proposals?.length) {
    structured.proposals.forEach((proposal, index) => {
      for (const field of ROADMAP_PROPOSAL_FIELDS) {
        const value = proposal[field as keyof typeof proposal];
        const present = Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
        if (!present) {
          warnings.push(`Roadmap proposal ${index + 1} is missing required field: ${field}.`);
        }
      }
    });
  } else {
    const lower = markdown.toLowerCase();
    for (const field of ROADMAP_PROPOSAL_FIELDS) {
      if (!lower.includes(field)) {
        warnings.push(`Roadmap proposals are missing required field signal: ${field}.`);
      }
    }
  }

  return warnings;
}

function countRoadmapProposals(markdown: string): number {
  const headingMatches = markdown.match(/^#{3,6}\s+\S.+$/gm);
  if (headingMatches && headingMatches.length >= MIN_ROADMAP_PROPOSALS) {
    return headingMatches.length;
  }

  const tableRows = markdown
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.+\|\s*$/.test(line))
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .filter((line) => !/\b(title|proposal)\b/i.test(line) || /\b(priority|confidence|effort|benefit|risk)\b/i.test(line) === false);
  return tableRows.length;
}

function countPathEvidence(markdown: string): number {
  const matches = new Set<string>();
  const pathPattern = /(?:^|[\s`])((?:\.?\/)?(?:src|test|tests|lib|app|scripts|docs|\.github)[/\w.-]*|(?:package(?:-lock)?\.json|README\.md|tsconfig\.json|Cargo\.toml|pyproject\.toml|go\.mod))(?=$|[\s`)\],.;:])/gm;
  for (const match of markdown.matchAll(pathPattern)) {
    const normalized = match[1].replace(/^\.\//, "").replace(/\/+$/g, "");
    if (normalized) {
      matches.add(normalized);
    }
  }
  return matches.size;
}

function scoreEvidenceQuality(phaseId: string, markdown: string): number {
  if (phaseId === "risk-and-bug") {
    return scoreRiskEvidence(markdown);
  }
  if (phaseId === "feature-roadmap") {
    return scoreRoadmapEvidence(markdown);
  }
  const structured = extractStructuredPhaseReport(markdown, phaseId, "quality-gate");
  const pathCount = countPathEvidence(markdown);
  let score = Math.min(35, pathCount * 6);
  score += Math.min(25, structured.evidenceReferences.length * 5);
  score += Math.min(20, structured.recommendations.length * 4);
  score += hasTestEvidence(markdown) ? 10 : 0;
  score += hasLineEvidence(markdown) ? 10 : 0;
  return Math.max(0, Math.min(100, score));
}

function scoreRiskEvidence(markdown: string): number {
  const extraction = extractFindingsWithSource(markdown);
  if (!extraction.findings.length) {
    return countPathEvidence(markdown) >= 3 ? 70 : 45;
  }
  const findingScores = extraction.findings.map((finding) => {
    const refs = finding.evidenceDetails?.length
      ? finding.evidenceDetails
      : (finding.evidenceReferences ?? []).map((reference) => typeof reference === "string" ? { path: reference } : reference);
    let score = 0;
    score += finding.paths.length ? 12 : 0;
    score += refs.length ? 15 : 0;
    score += refs.some((reference) => reference.startLine && reference.endLine) ? 18 : 0;
    score += refs.some((reference) => reference.quote) ? 14 : 0;
    score += finding.reproduction ? 10 : 0;
    score += finding.suggestedRegressionTest ? 10 : 0;
    score += finding.minimumFixScope ? 10 : 0;
    score += finding.recommendation ? 6 : 0;
    score += finding.evidenceValidation?.passed ? 5 : 0;
    return Math.min(100, score);
  });
  return Math.round(findingScores.reduce((sum, score) => sum + score, 0) / findingScores.length);
}

function scoreRoadmapEvidence(markdown: string): number {
  const structured = extractStructuredPhaseReport(markdown, "feature-roadmap", "quality-gate");
  const proposals = structured.proposals ?? [];
  if (!proposals.length) {
    return Math.min(70, countPathEvidence(markdown) * 8 + (hasLineEvidence(markdown) ? 10 : 0));
  }
  const proposalScores = proposals.map((proposal) => {
    let score = 0;
    score += proposal.evidence.length ? 20 : 0;
    score += proposal.affected.length ? 15 : 0;
    score += proposal.steps.length ? 15 : 0;
    score += proposal.benefit ? 10 : 0;
    score += proposal.risk ? 10 : 0;
    score += proposal.effort ? 10 : 0;
    score += proposal.priority ? 10 : 0;
    score += proposal.confidence ? 10 : 0;
    return Math.min(100, score);
  });
  return Math.round(proposalScores.reduce((sum, score) => sum + score, 0) / proposalScores.length);
}

function hasTestEvidence(markdown: string): boolean {
  return /\b(npm test|pytest|cargo test|go test|test\/|tests\/|\.test\.|\.spec\.|Suggested regression test)\b/i.test(markdown);
}

function hasLineEvidence(markdown: string): boolean {
  return /\b(?:line|lines|startLine|endLine)\b|:\d+\b/i.test(markdown);
}
