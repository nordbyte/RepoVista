import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";

export interface StateEnvelope<T> {
  schemaVersion: number;
  kind: string;
  data: T;
  migratedFrom?: number;
}

export async function readStateFile<T>(
  filePath: string,
  options: {
    kind: string;
    currentVersion: number;
    legacy?: (value: unknown) => T | undefined;
    migrate?: (value: unknown, fromVersion: number) => T | undefined;
    label: string;
  }
): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoVistaError(`Could not read RepoVista ${options.label} ${filePath}: ${message}`);
  }

  if (isEnvelope(parsed) && parsed.kind === options.kind) {
    if (parsed.schemaVersion === options.currentVersion) {
      return parsed.data as T;
    }
    const migrated = options.migrate?.(parsed.data, parsed.schemaVersion);
    if (migrated !== undefined) {
      return migrated;
    }
    throw new RepoVistaError(`Unsupported RepoVista ${options.label} schema version ${parsed.schemaVersion}: ${filePath}`);
  }

  const legacy = options.legacy?.(parsed);
  if (legacy !== undefined) {
    return legacy;
  }
  throw new RepoVistaError(`Invalid RepoVista ${options.label}: ${filePath}`);
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === code);
}

export async function writeStateFileAtomic<T>(
  filePath: string,
  envelope: StateEnvelope<T>
): Promise<void> {
  await writeJsonAtomic(filePath, envelope);
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function isEnvelope(value: unknown): value is StateEnvelope<unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as StateEnvelope<unknown>).schemaVersion === "number" &&
    typeof (value as StateEnvelope<unknown>).kind === "string" &&
    "data" in value
  );
}
