import { stat } from "node:fs/promises";
import type {
  DiffScope,
  PromptManifest,
  PromptManifestFile,
  PromptManifestPhase,
  ProjectFileSummary,
  SemanticFeature
} from "./types.js";

const CLIP_LIMIT = 18000;
const PREVIOUS_REPORT_SUMMARY_LIMIT = 14000;
const DEFAULT_PROJECT_FILE_LIMIT = 500;
const MAX_OMITTED_FILE_ENTRIES = 250;

export function createPromptManifest(
  runId: string,
  createdAt: Date,
  features: SemanticFeature[],
  since?: DiffScope
): PromptManifest {
  return {
    schemaVersion: 1,
    runId,
    createdAt: createdAt.toISOString(),
    since,
    features,
    phases: []
  };
}

export async function addPromptManifestPhase(
  manifest: PromptManifest,
  input: {
    phaseId: string;
    reportFile: string;
    prompt: string;
    inventoryPath: string;
    previousReports: Record<string, string>;
    promptFilePath?: string;
    featureMapPath?: string;
    projectFiles?: ProjectFileSummary[];
    projectFileLimit?: number;
    omittedProjectFileCount?: number;
  }
): Promise<void> {
  const includedFiles: PromptManifestFile[] = [
    await fileEntry(input.inventoryPath, "inventory")
  ];

  if (input.featureMapPath) {
    includedFiles.push(await fileEntry(input.featureMapPath, "feature-map"));
  }

  if (input.promptFilePath) {
    includedFiles.push(await fileEntry(input.promptFilePath, "prompt-file"));
  }

  for (const [fileName, content] of Object.entries(input.previousReports)) {
    if (fileName === input.reportFile) {
      continue;
    }
    includedFiles.push({
      path: fileName,
      role: "previous-report",
      bytes: Buffer.byteLength(content, "utf8"),
      includedBytes: Math.min(Buffer.byteLength(content, "utf8"), PREVIOUS_REPORT_SUMMARY_LIMIT),
      truncated: content.length > PREVIOUS_REPORT_SUMMARY_LIMIT,
      readable: true,
      inclusionReason: "evidence-oriented previous report summary prioritized for the current phase",
      tokenBudgetEstimate: Math.ceil(Math.min(Buffer.byteLength(content, "utf8"), PREVIOUS_REPORT_SUMMARY_LIMIT) / 4)
    });
  }

  const projectFileLimit = input.projectFileLimit ?? DEFAULT_PROJECT_FILE_LIMIT;
  const projectFiles = input.projectFiles ?? [];
  for (const file of projectFiles.slice(0, projectFileLimit)) {
    includedFiles.push({
      path: file.relativePath,
      role: "project-file",
      bytes: file.size,
      includedBytes: 0,
      truncated: false,
      readable: true,
      hashAlgorithm: file.hashAlgorithm,
      sha256: file.sha256,
      inclusionReason: file.scopeReason ?? "included through project scan metadata",
      tokenBudgetEstimate: 0,
      skippedReason: "file content was not embedded; path metadata was included through the inventory and feature map"
    });
  }

  const omittedProjectFiles = projectFiles.slice(projectFileLimit);
  const omittedFiles = omittedProjectFiles.slice(0, MAX_OMITTED_FILE_ENTRIES).map<PromptManifestFile>((file) => ({
    path: file.relativePath,
    role: "project-file",
    bytes: file.size,
    includedBytes: 0,
      truncated: true,
      readable: true,
      hashAlgorithm: file.hashAlgorithm,
      sha256: file.sha256,
      inclusionReason: file.scopeReason ?? "omitted after project file list limit",
      tokenBudgetEstimate: 0,
      skippedReason: "omitted from prompt manifest detail because the project file list limit was reached"
    }));
  const omittedFileCount = omittedProjectFiles.length + (input.omittedProjectFileCount ?? 0);
  const omittedFilesTruncated = omittedFileCount > omittedFiles.length;

  const phase: PromptManifestPhase = {
    phaseId: input.phaseId,
    reportFile: input.reportFile,
    promptBytes: Buffer.byteLength(input.prompt, "utf8"),
    approximateTokens: approximateTokens(input.prompt),
    includedFiles,
    omittedFiles,
    omittedFileCount,
    omittedFilesTruncated
  };
  manifest.phases.push(phase);
}

export function allowedEvidencePathsFromPromptManifest(
  manifest: PromptManifest,
  phaseId: string
): Set<string> | undefined {
  const phase = [...manifest.phases].reverse().find((item) => item.phaseId === phaseId || item.phaseId.startsWith(`${phaseId}-`));
  if (!phase) {
    return undefined;
  }
  const values = new Set<string>();
  for (const file of phase.includedFiles) {
    if (file.role === "project-file" && file.readable) {
      values.add(file.path);
    }
  }
  return values.size ? values : undefined;
}

function approximateTokens(content: string): number {
  return Math.ceil(Buffer.byteLength(content, "utf8") / 4);
}

async function fileEntry(filePath: string, role: PromptManifestFile["role"]): Promise<PromptManifestFile> {
  try {
    const fileStat = await stat(filePath);
    return {
      path: filePath,
      role,
      bytes: fileStat.size,
      includedBytes: Math.min(fileStat.size, CLIP_LIMIT),
      truncated: fileStat.size > CLIP_LIMIT,
      readable: fileStat.isFile(),
      inclusionReason: role === "inventory" ? "primary project inventory context" : "structured feature map context",
      tokenBudgetEstimate: Math.ceil(Math.min(fileStat.size, CLIP_LIMIT) / 4)
    };
  } catch {
    return {
      path: filePath,
      role,
      bytes: 0,
      includedBytes: 0,
      truncated: false,
      readable: false,
      skippedReason: "not readable"
    };
  }
}
