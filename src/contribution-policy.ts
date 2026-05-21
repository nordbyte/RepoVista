import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import type { AuditMeta, ContributionPolicyMode, PatchAttempt, PublishTarget, StructuredFinding } from "./types.js";

export interface ContributionPolicyGithubTarget {
  repository: string;
  commit: string;
}

export type ContributionPolicyDocumentKind =
  | "contributing"
  | "security"
  | "support"
  | "code-of-conduct"
  | "readme"
  | "issue-template"
  | "pull-request-template"
  | "other";

export interface ContributionPolicyDocument {
  path: string;
  kind: ContributionPolicyDocumentKind;
  title?: string;
  sha256: string;
  sizeBytes: number;
  text: string;
}

export interface ContributionPolicyTemplate {
  path: string;
  kind: "issue" | "pull-request";
  title?: string;
  fields: string[];
  sections: string[];
  sha256: string;
  sizeBytes: number;
  text: string;
}

export interface ContributionPolicyRules {
  issueRequiredSections: string[];
  pullRequestRequiredSections: string[];
  requiredChecks: string[];
  needsIssueFirst: boolean;
  requiresRealBehaviorProof: boolean;
  requiresAiDisclosure: boolean;
  publicSecurityReportBlocked: boolean;
  securityReportInstructions?: string;
  notes: string[];
}

export interface ContributionPolicyBundle {
  schemaVersion: 1;
  repository: string;
  commit: string;
  sourceRoot: string;
  discoveredAt: string;
  mode: ContributionPolicyMode;
  documents: ContributionPolicyDocument[];
  issueTemplates: ContributionPolicyTemplate[];
  pullRequestTemplates: ContributionPolicyTemplate[];
  rules: ContributionPolicyRules;
  warnings: string[];
}

export interface ContributionPolicyEvaluation {
  bundle: ContributionPolicyBundle;
  target: PublishTarget;
  warnings: string[];
  blockers: string[];
}

interface ContributionPolicyInput {
  runDir: string;
  meta: AuditMeta;
  github: ContributionPolicyGithubTarget;
  mode: ContributionPolicyMode;
  target: PublishTarget;
  findings: StructuredFinding[];
  validationCommands?: string[];
  runChecks?: boolean;
  force?: boolean;
  now?: Date;
}

interface Candidate {
  path: string;
  kind: ContributionPolicyDocumentKind;
}

const MAX_POLICY_FILE_BYTES = 256 * 1024;

const STATIC_CANDIDATES: readonly Candidate[] = [
  { path: "CONTRIBUTING.md", kind: "contributing" },
  { path: "CONTRIBUTING", kind: "contributing" },
  { path: "CONTRIBUTING.rst", kind: "contributing" },
  { path: "docs/CONTRIBUTING.md", kind: "contributing" },
  { path: ".github/CONTRIBUTING.md", kind: "contributing" },
  { path: "SECURITY.md", kind: "security" },
  { path: ".github/SECURITY.md", kind: "security" },
  { path: "SUPPORT.md", kind: "support" },
  { path: ".github/SUPPORT.md", kind: "support" },
  { path: "CODE_OF_CONDUCT.md", kind: "code-of-conduct" },
  { path: ".github/CODE_OF_CONDUCT.md", kind: "code-of-conduct" },
  { path: "README.md", kind: "readme" },
  { path: ".github/ISSUE_TEMPLATE.md", kind: "issue-template" },
  { path: "ISSUE_TEMPLATE.md", kind: "issue-template" },
  { path: ".github/PULL_REQUEST_TEMPLATE.md", kind: "pull-request-template" },
  { path: "PULL_REQUEST_TEMPLATE.md", kind: "pull-request-template" },
  { path: "docs/PULL_REQUEST_TEMPLATE.md", kind: "pull-request-template" }
];

export async function prepareContributionPolicy(input: ContributionPolicyInput): Promise<ContributionPolicyEvaluation> {
  const sourceRoot = path.resolve(input.meta.projectRoot);
  const discoveredAt = (input.now ?? new Date()).toISOString();
  const bundle = input.mode === "off"
    ? emptyContributionPolicyBundle(input, sourceRoot, discoveredAt)
    : await discoverContributionPolicy(input, sourceRoot, discoveredAt);
  const initialBlockers = evaluateContributionPolicyBlockers(bundle, input.target, input.findings, input.validationCommands ?? [], Boolean(input.runChecks));
  const warnings = [...bundle.warnings];
  let blockers = initialBlockers;

  if (input.mode === "warn" && blockers.length) {
    warnings.push(...blockers.map((blocker) => `Would block in enforce mode: ${blocker}`));
    blockers = [];
  }

  if (input.force && blockers.length) {
    warnings.push(...blockers.map((blocker) => `Ignored by --force: ${blocker}`));
    blockers = [];
  }

  const evaluation: ContributionPolicyEvaluation = {
    bundle: {
      ...bundle,
      warnings
    },
    target: input.target,
    warnings,
    blockers
  };
  await writeContributionPolicyArtifact(input.runDir, evaluation);
  return evaluation;
}

export function assertContributionPolicyAllowsPublish(policy: ContributionPolicyEvaluation): void {
  if (!policy.blockers.length) {
    return;
  }
  throw new RepoVistaError([
    "Repository contribution guidelines block this GitHub publication.",
    ...policy.blockers.map((blocker) => `- ${blocker}`),
    "Use --contribution-policy warn to preview/post with warnings, or --force if you intentionally want to bypass the gate."
  ].join("\n"));
}

export function renderContributionPolicyDryRunSummary(policy: ContributionPolicyEvaluation): string {
  const bundle = policy.bundle;
  const sources = policySourcePaths(bundle);
  return [
    `Contribution policy: ${bundle.mode}`,
    `Contribution sources: ${sources.length ? sources.join(", ") : "none found"}`,
    policy.blockers.length ? `Contribution blockers:\n${policy.blockers.map((blocker) => `- ${blocker}`).join("\n")}` : "Contribution blockers: none",
    policy.warnings.length ? `Contribution warnings:\n${policy.warnings.map((warning) => `- ${warning}`).join("\n")}` : "Contribution warnings: none"
  ].join("\n");
}

export function renderContributionPolicyIssueSection(bundle: ContributionPolicyBundle, finding: StructuredFinding): string {
  if (!hasContributionPolicyContent(bundle)) {
    return "";
  }
  const lines = [
    "## Contribution Guidelines",
    "",
    `- Policy mode: ${bundle.mode}`,
    `- Sources reviewed: ${formatPolicySources(bundle)}`,
    ...ruleSummaryLines(bundle.rules, "issue")
  ];
  const sections = renderRequiredSections("Issue Template Fields", bundle.rules.issueRequiredSections, issueTemplateValue(finding));
  return `${lines.join("\n")}${sections ? `\n\n${sections}` : ""}\n`;
}

export function renderContributionPolicyPullRequestSection(bundle: ContributionPolicyBundle, patch: PatchAttempt): string {
  if (!hasContributionPolicyContent(bundle)) {
    return "";
  }
  const lines = [
    "## Contribution Guidelines",
    "",
    `- Policy mode: ${bundle.mode}`,
    `- Sources reviewed: ${formatPolicySources(bundle)}`,
    ...ruleSummaryLines(bundle.rules, "pr")
  ];
  const sections = renderRequiredSections("Pull Request Template Fields", bundle.rules.pullRequestRequiredSections, pullRequestTemplateValue(patch));
  return `${lines.join("\n")}${sections ? `\n\n${sections}` : ""}\n`;
}

export function renderContributionPolicyPrompt(bundle: ContributionPolicyBundle): string {
  if (!hasContributionPolicyContent(bundle)) {
    return "Repository contribution guidelines: none discovered by RepoVista.";
  }
  const rules = bundle.rules;
  const lines = [
    "Repository contribution guidelines discovered by RepoVista:",
    `- Sources: ${formatPolicySources(bundle)}`,
    rules.needsIssueFirst ? "- The repository asks contributors to discuss or open an issue before some PRs." : undefined,
    rules.requiresRealBehaviorProof ? "- Include concrete behavior proof, reproduction details, or validation evidence where relevant." : undefined,
    rules.requiresAiDisclosure ? "- Disclose AI assistance in the PR body." : undefined,
    rules.requiredChecks.length ? `- Checks mentioned by guidelines: ${rules.requiredChecks.join(", ")}` : undefined,
    rules.pullRequestRequiredSections.length ? `- PR template sections to satisfy: ${rules.pullRequestRequiredSections.join(", ")}` : undefined
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

async function discoverContributionPolicy(input: ContributionPolicyInput, sourceRoot: string, discoveredAt: string): Promise<ContributionPolicyBundle> {
  const candidates = await collectPolicyCandidates(sourceRoot);
  const documents: ContributionPolicyDocument[] = [];
  for (const candidate of candidates) {
    const document = await readPolicyDocument(sourceRoot, candidate);
    if (!document) {
      continue;
    }
    if (document.kind === "readme" && !readmeLooksPolicyRelevant(document.text)) {
      continue;
    }
    documents.push(document);
  }

  const issueTemplates = documents
    .filter((document) => document.kind === "issue-template")
    .map((document) => templateFromDocument(document, "issue"));
  const pullRequestTemplates = documents
    .filter((document) => document.kind === "pull-request-template")
    .map((document) => templateFromDocument(document, "pull-request"));
  const rules = extractContributionPolicyRules(documents, issueTemplates, pullRequestTemplates);
  const warnings = documents.length ? [] : ["No repository contribution guideline files or templates were found in the analyzed GitHub checkout."];

  return {
    schemaVersion: 1,
    repository: input.github.repository,
    commit: input.github.commit,
    sourceRoot,
    discoveredAt,
    mode: input.mode,
    documents,
    issueTemplates,
    pullRequestTemplates,
    rules,
    warnings
  };
}

function emptyContributionPolicyBundle(input: ContributionPolicyInput, sourceRoot: string, discoveredAt: string): ContributionPolicyBundle {
  return {
    schemaVersion: 1,
    repository: input.github.repository,
    commit: input.github.commit,
    sourceRoot,
    discoveredAt,
    mode: input.mode,
    documents: [],
    issueTemplates: [],
    pullRequestTemplates: [],
    rules: {
      issueRequiredSections: [],
      pullRequestRequiredSections: [],
      requiredChecks: [],
      needsIssueFirst: false,
      requiresRealBehaviorProof: false,
      requiresAiDisclosure: false,
      publicSecurityReportBlocked: false,
      notes: []
    },
    warnings: []
  };
}

async function collectPolicyCandidates(sourceRoot: string): Promise<Candidate[]> {
  const candidates = [...STATIC_CANDIDATES];
  candidates.push(...await directoryCandidates(sourceRoot, ".github/ISSUE_TEMPLATE", "issue-template", [".md", ".markdown", ".yml", ".yaml"]));
  candidates.push(...await directoryCandidates(sourceRoot, ".github/PULL_REQUEST_TEMPLATE", "pull-request-template", [".md", ".markdown"]));
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = normalizePolicyPath(candidate.path);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

async function directoryCandidates(sourceRoot: string, relativeDir: string, kind: ContributionPolicyDocumentKind, extensions: string[]): Promise<Candidate[]> {
  try {
    const entries = await readdir(path.join(sourceRoot, relativeDir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase()))
      .map((entry) => ({ path: normalizePolicyPath(path.posix.join(relativeDir, entry.name)), kind }));
  } catch {
    return [];
  }
}

async function readPolicyDocument(sourceRoot: string, candidate: Candidate): Promise<ContributionPolicyDocument | undefined> {
  const relativePath = normalizePolicyPath(candidate.path);
  const absolutePath = path.resolve(sourceRoot, relativePath);
  if (!isInside(sourceRoot, absolutePath)) {
    return undefined;
  }
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_POLICY_FILE_BYTES) {
      return undefined;
    }
    const text = await readFile(absolutePath, "utf8");
    return {
      path: relativePath,
      kind: candidate.kind,
      title: firstHeading(text) ?? yamlName(text),
      sha256: createHash("sha256").update(text).digest("hex"),
      sizeBytes: Buffer.byteLength(text, "utf8"),
      text
    };
  } catch {
    return undefined;
  }
}

function templateFromDocument(document: ContributionPolicyDocument, kind: ContributionPolicyTemplate["kind"]): ContributionPolicyTemplate {
  const fields = templateFields(document.text, document.path);
  const sections = normalizeSectionNames([...markdownHeadings(document.text), ...fields]);
  return {
    path: document.path,
    kind,
    title: document.title,
    fields,
    sections,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
    text: document.text
  };
}

function extractContributionPolicyRules(
  documents: ContributionPolicyDocument[],
  issueTemplates: ContributionPolicyTemplate[],
  pullRequestTemplates: ContributionPolicyTemplate[]
): ContributionPolicyRules {
  const text = documents.map((document) => document.text).join("\n\n");
  const lower = text.toLowerCase();
  const requiredChecks = extractRequiredChecks(text);
  const securityReportInstructions = securityInstructions(documents);
  const publicSecurityReportBlocked = Boolean(securityReportInstructions) &&
    /(?:privately|private|email|security@|responsible disclosure|do not.{0,40}(?:public|issue)|not.{0,40}(?:public|issue))/.test(securityReportInstructions?.toLowerCase() ?? "");
  const rules: ContributionPolicyRules = {
    issueRequiredSections: normalizeSectionNames(issueTemplates.flatMap((template) => template.sections)),
    pullRequestRequiredSections: normalizeSectionNames(pullRequestTemplates.flatMap((template) => template.sections)),
    requiredChecks,
    needsIssueFirst: /(?:open|file|create)\s+(?:an?\s+)?issue\s+(?:first|before)|(?:discuss|discussion).{0,80}(?:issue|proposal|maintainer).{0,80}(?:before|first)|before\s+(?:opening|submitting)\s+(?:a\s+)?pull request/.test(lower),
    requiresRealBehaviorProof: /steps to reproduce|reproduction|minimal repro|actual behavior|expected behavior|proof of behavior|real behavior proof|screenshots?|logs?/.test(lower),
    requiresAiDisclosure: /(?:ai-assisted|ai assisted|ai-generated|ai generated|llm|chatgpt|copilot).{0,80}(?:disclos|mention|label|required|must|should)|(?:disclos|mention).{0,80}(?:ai|llm|chatgpt|copilot)/.test(lower),
    publicSecurityReportBlocked,
    securityReportInstructions,
    notes: []
  };

  if (requiredChecks.length) {
    rules.notes.push(`Detected validation commands: ${requiredChecks.join(", ")}`);
  }
  if (rules.issueRequiredSections.length) {
    rules.notes.push(`Detected issue template sections: ${rules.issueRequiredSections.join(", ")}`);
  }
  if (rules.pullRequestRequiredSections.length) {
    rules.notes.push(`Detected pull request template sections: ${rules.pullRequestRequiredSections.join(", ")}`);
  }
  return rules;
}

function evaluateContributionPolicyBlockers(
  bundle: ContributionPolicyBundle,
  target: PublishTarget,
  findings: StructuredFinding[],
  validationCommands: string[],
  runChecks: boolean
): string[] {
  if (bundle.mode === "off") {
    return [];
  }
  const blockers: string[] = [];
  const rules = bundle.rules;
  if (rules.publicSecurityReportBlocked && findings.some(findingLooksSecuritySensitive)) {
    blockers.push("Security-sensitive findings should be reported through the repository's private security disclosure channel instead of a public GitHub issue or pull request.");
  }
  if (target === "pr" && rules.needsIssueFirst && findings.some((finding) => !finding.issue?.url)) {
    blockers.push("Repository guidelines ask contributors to open or discuss an issue before submitting this kind of pull request; no linked issue is recorded for at least one selected finding.");
  }
  if (target === "pr" && rules.requiredChecks.length) {
    const missing = rules.requiredChecks.filter((command) => !validationCommands.some((provided) => sameCommand(provided, command)));
    if (missing.length && !runChecks) {
      blockers.push(`Repository guidelines mention validation checks, but --no-run-checks is active: ${missing.join(", ")}.`);
    } else if (missing.length) {
      blockers.push(`Repository guidelines mention validation checks that were not passed with --check: ${missing.join(", ")}.`);
    }
  }
  return blockers;
}

function findingLooksSecuritySensitive(finding: StructuredFinding): boolean {
  const text = [
    finding.title,
    finding.category,
    finding.severity,
    finding.evidence,
    finding.problemRationale,
    finding.recommendation,
    ...(finding.labels ?? [])
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(security|vulnerab|cve|auth|token|secret|credential|password|private key|xss|csrf|injection|rce|ssrf|exposure)\b/.test(text);
}

async function writeContributionPolicyArtifact(runDir: string, evaluation: ContributionPolicyEvaluation): Promise<void> {
  await writeFile(path.join(runDir, "contribution-policy.json"), `${JSON.stringify({
    schemaVersion: 1,
    target: evaluation.target,
    blockers: evaluation.blockers,
    warnings: evaluation.warnings,
    bundle: evaluation.bundle
  }, null, 2)}\n`, "utf8");
}

function policySourcePaths(bundle: ContributionPolicyBundle): string[] {
  return Array.from(new Set([
    ...bundle.documents.map((document) => document.path),
    ...bundle.issueTemplates.map((template) => template.path),
    ...bundle.pullRequestTemplates.map((template) => template.path)
  ])).sort();
}

function formatPolicySources(bundle: ContributionPolicyBundle): string {
  const sources = policySourcePaths(bundle);
  return sources.length ? sources.join(", ") : "none";
}

function hasContributionPolicyContent(bundle: ContributionPolicyBundle): boolean {
  return bundle.mode !== "off" && (bundle.documents.length > 0 || bundle.issueTemplates.length > 0 || bundle.pullRequestTemplates.length > 0);
}

function ruleSummaryLines(rules: ContributionPolicyRules, target: PublishTarget): string[] {
  const lines: string[] = [];
  if (target === "pr" && rules.needsIssueFirst) {
    lines.push("- Issue-first guidance: repository asks contributors to discuss or open an issue before some PRs.");
  }
  if (rules.requiresRealBehaviorProof) {
    lines.push("- Behavior proof: include reproduction, observed behavior, or validation details where applicable.");
  }
  if (rules.requiresAiDisclosure) {
    lines.push("- AI disclosure: RepoVista helped identify and prepare this publication from an audit finding.");
  }
  if (target === "pr" && rules.requiredChecks.length) {
    lines.push(`- Guideline checks: ${rules.requiredChecks.join(", ")}`);
  }
  if (rules.publicSecurityReportBlocked) {
    lines.push(`- Security reporting: ${rules.securityReportInstructions ?? "private security disclosure requested by repository policy"}`);
  }
  return lines.length ? lines : ["- No explicit blocking contribution rules were detected."];
}

function renderRequiredSections(title: string, sections: string[], valueForSection: (section: string) => string): string {
  const normalized = sections.filter((section) => !isNoiseSection(section));
  if (!normalized.length) {
    return "";
  }
  return [
    `## ${title}`,
    "",
    ...normalized.flatMap((section) => [
      `### ${section}`,
      "",
      valueForSection(section),
      ""
    ])
  ].join("\n").trimEnd();
}

function issueTemplateValue(finding: StructuredFinding): (section: string) => string {
  return (section) => {
    const normalized = section.toLowerCase();
    if (/summary|description|what happened|problem/.test(normalized)) {
      return finding.problemRationale ?? finding.evidence ?? finding.title;
    }
    if (/repro|steps|actual|observed/.test(normalized)) {
      return finding.reproduction ?? finding.evidence ?? "n/a";
    }
    if (/expected/.test(normalized)) {
      return finding.recommendation ?? "n/a";
    }
    if (/environment|version/.test(normalized)) {
      return "n/a";
    }
    if (/logs?|evidence|screenshots?/.test(normalized)) {
      return finding.evidence ?? "n/a";
    }
    return finding.recommendation ?? finding.evidence ?? "n/a";
  };
}

function pullRequestTemplateValue(patch: PatchAttempt): (section: string) => string {
  return (section) => {
    const normalized = section.toLowerCase();
    if (/summary|description|what|change/.test(normalized)) {
      return patch.plan;
    }
    if (/test|validation|check/.test(normalized)) {
      return patch.commandsRun.length
        ? patch.commandsRun.map((command) => `- ${command.command}: ${command.exitCode ?? "unknown"}${command.timedOut ? " (timed out)" : ""}`).join("\n")
        : "No validation commands recorded.";
    }
    if (/issue|related|link/.test(normalized)) {
      return patch.findingIds.map((id) => `- RepoVista finding ${id}`).join("\n");
    }
    if (/checklist/.test(normalized)) {
      return "- [x] Kept change scoped to the selected RepoVista finding(s).";
    }
    return "n/a";
  };
}

function extractRequiredChecks(text: string): string[] {
  const candidates = new Set<string>();
  for (const value of codeLikeFragments(text)) {
    const normalized = normalizeCommandCandidate(value);
    if (normalized && isLikelyValidationCommand(normalized)) {
      candidates.add(normalized);
    }
  }
  return Array.from(candidates).sort();
}

function codeLikeFragments(text: string): string[] {
  const fragments: string[] = [];
  for (const match of text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) {
    fragments.push(...(match[1] ?? "").split(/\r?\n/));
  }
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    fragments.push(match[1] ?? "");
  }
  return fragments;
}

function normalizeCommandCandidate(value: string): string | undefined {
  const trimmed = value.trim().replace(/^\$\s*/, "").replace(/^>\s*/, "");
  if (!trimmed || /[;&|`$<>]/.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\s+/g, " ");
}

function isLikelyValidationCommand(command: string): boolean {
  return /^(?:npm|pnpm|yarn|bun) (?:run )?(?:test|lint|typecheck|check|build|audit|security:audit)(?:\b.*)?$/.test(command) ||
    /^(?:cargo test|cargo clippy|go test \.\/\.\.\.|pytest|python -m pytest|ruff check|mypy|make test|make check|gradle test|\.\/gradlew test)(?:\b.*)?$/.test(command);
}

function securityInstructions(documents: ContributionPolicyDocument[]): string | undefined {
  const securityDocs = documents.filter((document) => document.kind === "security" || /security|vulnerab|disclos/i.test(document.text));
  for (const document of securityDocs) {
    const lines = document.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const relevant = lines.filter((line) => /security@|vulnerab|privately|private|responsible disclosure|do not.*public|email/i.test(line));
    if (relevant.length) {
      return relevant.slice(0, 4).join(" ");
    }
  }
  return undefined;
}

function markdownHeadings(text: string): string[] {
  return Array.from(text.matchAll(/^#{1,4}\s+(.+?)\s*#*\s*$/gm))
    .map((match) => cleanTemplateLabel(match[1] ?? ""))
    .filter(Boolean);
}

function templateFields(text: string, filePath: string): string[] {
  if (/\.(?:ya?ml)$/i.test(filePath)) {
    return Array.from(text.matchAll(/^\s*label:\s*["']?(.+?)["']?\s*$/gm))
      .map((match) => cleanTemplateLabel(match[1] ?? ""))
      .filter(Boolean);
  }
  const fields = Array.from(text.matchAll(/^\s*(?:[-*]\s+)?(?:\*\*)?([A-Z][A-Za-z0-9 /_-]{2,80})(?:\*\*)?\s*:\s*$/gm))
    .map((match) => cleanTemplateLabel(match[1] ?? ""))
    .filter(Boolean);
  return fields;
}

function normalizeSectionNames(values: string[]): string[] {
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const value of values) {
    const cleaned = cleanTemplateLabel(value);
    if (!cleaned || cleaned.length > 80) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sections.push(cleaned);
  }
  return sections;
}

function cleanTemplateLabel(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[*_`#>-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:$/, "");
}

function isNoiseSection(section: string): boolean {
  return /^(name|description|title|labels|assignees|about)$/i.test(section);
}

function firstHeading(text: string): string | undefined {
  return markdownHeadings(text)[0];
}

function yamlName(text: string): string | undefined {
  const match = text.match(/^\s*name:\s*["']?(.+?)["']?\s*$/m);
  return match ? cleanTemplateLabel(match[1] ?? "") : undefined;
}

function readmeLooksPolicyRelevant(text: string): boolean {
  return /contribut|pull request|issue|bug report|security|vulnerab/i.test(text);
}

function sameCommand(left: string, right: string): boolean {
  return normalizeCommandComparable(left) === normalizeCommandComparable(right);
}

function normalizeCommandComparable(command: string): string {
  return command.trim().replace(/\s+/g, " ").replace(/^npm run test\b/, "npm test");
}

function normalizePolicyPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
