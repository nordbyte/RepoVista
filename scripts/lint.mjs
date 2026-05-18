import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CHECK_ROOTS = [".github", "scripts", "src", "test"];
const ROOT_FILES = ["package.json", "package-lock.json", "README.md", "repovista.md", "tsconfig.json"];
const EXTENSIONS = new Set([".js", ".mjs", ".ts", ".json", ".md", ".yml", ".yaml"]);
const IGNORED_DIRS = new Set([".git", ".repovista", "dist", "node_modules"]);

const failures = [];

for (const file of ROOT_FILES) {
  await lintFile(path.join(ROOT, file));
}

for (const directory of CHECK_ROOTS) {
  await walk(path.join(ROOT, directory));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(fullPath);
      }
      continue;
    }
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      await lintFile(fullPath);
    }
  }
}

async function lintFile(filePath) {
  const relative = path.relative(ROOT, filePath).split(path.sep).join("/");
  const content = await readFile(filePath, "utf8");

  if (content.includes("\r")) {
    failures.push(`${relative}: contains CRLF line endings`);
  }
  if (!content.endsWith("\n")) {
    failures.push(`${relative}: missing trailing newline`);
  }

  const lines = content.split(/\n/);
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      failures.push(`${relative}:${index + 1}: trailing whitespace`);
    }
  });
}
