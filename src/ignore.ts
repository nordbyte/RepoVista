import path from "node:path";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".repovista",
  ".codex",
  ".agents",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  "tmp",
  "temp",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "target"
]);

const ALWAYS_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".repovista"
]);

const IGNORED_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".bz2",
  ".class",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".obj",
  ".otf",
  ".pdf",
  ".png",
  ".rar",
  ".so",
  ".tar",
  ".tgz",
  ".ttf",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip"
]);

export interface IgnoreMatcher {
  shouldIgnore(relativePath: string, isDirectory: boolean): boolean;
}

export interface IgnoreMatcherOptions {
  projectRoot: string;
  outDir: string;
  includePatterns?: string[];
  ignorePatterns?: string[];
}

export function createIgnoreMatcher(options: IgnoreMatcherOptions): IgnoreMatcher {
  const outRelative = normalizeRelative(path.relative(options.projectRoot, path.resolve(options.projectRoot, options.outDir)));
  const includePatterns = (options.includePatterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  const customPatterns = (options.ignorePatterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);

  return {
    shouldIgnore(relativePath: string, isDirectory: boolean): boolean {
      const normalized = normalizeRelative(relativePath);
      if (!normalized || normalized === ".") {
        return false;
      }

      const segments = normalized.split("/");
      if (segments.some((segment) => ALWAYS_IGNORED_DIRECTORIES.has(segment))) {
        return true;
      }

      if (outRelative && (normalized === outRelative || normalized.startsWith(`${outRelative}/`))) {
        return true;
      }

      if (includePatterns.some((pattern) => matchesPatternForTraversal(normalized, pattern, isDirectory))) {
        return false;
      }

      if (segments.some((segment) => DEFAULT_IGNORED_DIRECTORIES.has(segment))) {
        return true;
      }

      if (!isDirectory && IGNORED_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
        return true;
      }

      return customPatterns.some((pattern) => matchesPattern(normalized, pattern));
    }
  };
}

export function normalizeRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

export function matchesPattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = normalizeRelative(relativePath);
  const normalizedPattern = normalizeRelative(pattern);

  if (!normalizedPattern) {
    return false;
  }

  if (!normalizedPattern.includes("/")) {
    const regex = globToRegExp(normalizedPattern);
    return normalizedPath.split("/").some((segment) => regex.test(segment));
  }

  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function matchesPatternForTraversal(relativePath: string, pattern: string, isDirectory: boolean): boolean {
  const normalizedPattern = normalizeRelative(pattern);
  if (matchesPattern(relativePath, normalizedPattern)) {
    return true;
  }

  if (!isDirectory) {
    return false;
  }

  const directoryPrefix = `${relativePath}/`;
  return normalizedPattern.startsWith(directoryPrefix) || normalizedPattern.startsWith(`${directoryPrefix}**`);
}

export function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegex(char);
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegex(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}
