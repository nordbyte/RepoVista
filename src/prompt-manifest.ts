import { stat } from "node:fs/promises";
import type {
  DiffScope,
  PromptManifest,
  PromptManifestFile,
  PromptManifestPhase,
  SemanticFeature
} from "./types.js";

const CLIP_LIMIT = 18000;

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
    featureMapPath?: string;
  }
): Promise<void> {
  const includedFiles: PromptManifestFile[] = [
    await fileEntry(input.inventoryPath, "inventory")
  ];

  if (input.featureMapPath) {
    includedFiles.push(await fileEntry(input.featureMapPath, "feature-map"));
  }

  for (const [fileName, content] of Object.entries(input.previousReports)) {
    if (fileName === input.reportFile) {
      continue;
    }
    includedFiles.push({
      path: fileName,
      role: "previous-report",
      bytes: Buffer.byteLength(content, "utf8"),
      includedBytes: Math.min(Buffer.byteLength(content, "utf8"), CLIP_LIMIT),
      truncated: content.length > CLIP_LIMIT,
      readable: true
    });
  }

  const phase: PromptManifestPhase = {
    phaseId: input.phaseId,
    reportFile: input.reportFile,
    promptBytes: Buffer.byteLength(input.prompt, "utf8"),
    approximateTokens: approximateTokens(input.prompt),
    includedFiles,
    omittedFiles: []
  };
  manifest.phases.push(phase);
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
      readable: fileStat.isFile()
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
