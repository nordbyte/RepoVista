import { buildCodexExecArgs as buildProviderCodexExecArgs } from "./providers/codex.js";
import { runProviderPhase, type SpawnAdapter } from "./provider-runner.js";
import type { CodexRunRequest, CodexRunResult } from "./types.js";

export type { SpawnAdapter } from "./provider-runner.js";

export function buildCodexExecArgs(request: CodexRunRequest): string[] {
  return buildProviderCodexExecArgs({ ...request, provider: "codex" });
}

export async function runCodexPhase(
  request: CodexRunRequest,
  spawnAdapter?: SpawnAdapter
): Promise<CodexRunResult> {
  return runProviderPhase({ ...request, provider: "codex" }, spawnAdapter);
}
