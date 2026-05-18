import type { AuditOptions, AuditProfileId } from "./types.js";

export interface AuditProfileDefinition {
  id: AuditProfileId;
  title: string;
  description: string;
  options: Partial<Pick<
    AuditOptions,
    "phases" | "runChecks" | "strictReports" | "repairReports" | "parallel" | "prMode" | "since" | "exportFormats" | "incremental"
  >>;
}

export const AUDIT_PROFILES: readonly AuditProfileDefinition[] = [
  {
    id: "quick",
    title: "Quick",
    description: "Fast orientation pass with summary and risk focus.",
    options: {
      phases: ["risk-and-bug", "summary"],
      parallel: "off",
      incremental: true
    }
  },
  {
    id: "security",
    title: "Security",
    description: "Stricter risk-oriented review with checks and repair pass enabled.",
    options: {
      phases: ["code-quality", "risk-and-bug", "summary"],
      runChecks: true,
      strictReports: true,
      repairReports: true,
      exportFormats: ["sarif", "github", "jsonl"],
      incremental: true
    }
  },
  {
    id: "pr-review",
    title: "PR Review",
    description: "Diff-focused review for pull requests.",
    options: {
      phases: ["code-quality", "risk-and-bug", "summary"],
      prMode: true,
      since: "origin/main",
      runChecks: true,
      parallel: "auto",
      exportFormats: ["github", "jsonl"],
      incremental: true
    }
  },
  {
    id: "release-readiness",
    title: "Release Readiness",
    description: "Full strict audit before tagging or publishing.",
    options: {
      phases: ["all"],
      runChecks: true,
      strictReports: true,
      repairReports: true,
      parallel: "auto",
      exportFormats: ["sarif", "html", "jsonl", "github"],
      incremental: true
    }
  },
  {
    id: "architecture",
    title: "Architecture",
    description: "Architecture and roadmap-focused review.",
    options: {
      phases: ["architecture", "feature-roadmap", "summary"],
      parallel: "auto",
      exportFormats: ["html", "jsonl"],
      incremental: true
    }
  }
];

export function applyAuditProfile(options: AuditOptions): AuditOptions {
  if (!options.auditProfile) {
    return options;
  }
  const profile = AUDIT_PROFILES.find((item) => item.id === options.auditProfile);
  if (!profile) {
    return options;
  }
  const profileOptions = profile.options;
  return {
    ...options,
    phases: options.phases.length ? options.phases : [...(profileOptions.phases ?? options.phases)],
    runChecks: options.runChecks || Boolean(profileOptions.runChecks),
    strictReports: options.strictReports || Boolean(profileOptions.strictReports),
    repairReports: options.repairReports || Boolean(profileOptions.repairReports),
    parallel: options.parallel === "off" && profileOptions.parallel ? profileOptions.parallel : options.parallel,
    prMode: options.prMode ?? profileOptions.prMode,
    since: options.since ?? profileOptions.since,
    exportFormats: options.exportFormats.length
      ? options.exportFormats
      : [...(profileOptions.exportFormats ?? options.exportFormats)],
    incremental: options.incremental || Boolean(profileOptions.incremental)
  };
}

export function runProfilesCommand(json: boolean): string {
  if (json) {
    return `${JSON.stringify(AUDIT_PROFILES, null, 2)}\n`;
  }
  return `RepoVista audit profiles:\n${AUDIT_PROFILES.map((profile) => [
    `- ${profile.id}: ${profile.title}`,
    `  ${profile.description}`,
    `  phases: ${(profile.options.phases ?? ["all"]).join(", ")}`
  ].join("\n")).join("\n")}\n`;
}
