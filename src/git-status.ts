export function parseGitStatusFiles(stdout: string): string[] {
  const files = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 4) {
      continue;
    }
    const status = line.slice(0, 2);
    if (status === "!!") {
      continue;
    }
    let file = line.slice(3).trim();
    if (!file) {
      continue;
    }
    const renameIndex = file.lastIndexOf(" -> ");
    if (renameIndex !== -1) {
      file = file.slice(renameIndex + 4).trim();
    }
    files.add(unquoteGitPath(file));
  }
  return Array.from(files).sort();
}

function unquoteGitPath(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return value;
}
