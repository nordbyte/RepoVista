import { createHash } from "node:crypto";
import type { FindingEvidenceReference, StructuredFinding } from "./types.js";

export function stableId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}_${hash}`;
}

export function findingSignature(finding: Pick<StructuredFinding, "title" | "severity" | "category" | "paths" | "evidenceReferences">): string {
  return stableId("sig", [
    normalizeText(finding.severity),
    normalizeText(finding.category ?? ""),
    normalizeText(finding.title),
    [...(finding.paths ?? [])].sort(),
    [...(finding.evidenceReferences ?? [])].map(normalizeReference).sort()
  ]);
}

export function stableFindingId(finding: Pick<StructuredFinding, "title" | "severity" | "category" | "paths" | "evidenceReferences">): string {
  return stableId("fnd", [findingSignature(finding)]);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeReference(reference: string | FindingEvidenceReference): string {
  if (typeof reference === "string") {
    return reference;
  }
  return [
    reference.path,
    reference.startLine ?? "",
    reference.endLine ?? "",
    normalizeText(reference.quote ?? ""),
    normalizeText(reference.symbol ?? "")
  ].join(":");
}
