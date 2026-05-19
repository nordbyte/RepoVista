import { PreflightError } from "./errors.js";
import { checkProjectMapFreshness, initializeProjectMap, loadProjectMap, renderProjectPlan } from "./project-map.js";
import { isRecognizableProject } from "./preflight.js";
import type { AuditOptions } from "./types.js";

export async function runInitCommand(options: AuditOptions, projectRoot = process.cwd(), now = new Date()): Promise<string> {
  if (!await isRecognizableProject(projectRoot)) {
    throw new PreflightError(
      "The current directory does not look like a code project. Run RepoVista from the project root before initializing."
    );
  }
  const { map, mapPath } = await initializeProjectMap(projectRoot, options, now);
  return `Initialized RepoVista project map: ${mapPath}\n\n${renderProjectPlan(map, "auto")}`;
}

export async function runPlanCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  if (options.refresh) {
    const { map, mapPath } = await initializeProjectMap(projectRoot, options);
    return `Refreshed RepoVista project map: ${mapPath}\n\n${renderProjectPlan(map, options.parallel === "off" ? "auto" : options.parallel)}`;
  }

  const loaded = await loadProjectMap(projectRoot, options.outDir);
  if (!loaded) {
    throw new PreflightError("RepoVista project map was not found. Run `repovista init` first.");
  }
  const freshness = await checkProjectMapFreshness(projectRoot, options, loaded.map);
  const warning = freshness.stale
    ? `Warning: RepoVista project map appears stale (${freshness.warnings.join("; ")}). Run \`repovista plan --refresh\` or \`repovista init\` before parallel audits.\n\n`
    : "";
  return `${warning}${renderProjectPlan(loaded.map, options.parallel === "off" ? "auto" : options.parallel)}`;
}
