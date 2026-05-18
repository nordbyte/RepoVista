import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import type { AuditOptions } from "./types.js";

const WORKFLOW = `name: RepoVista

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  security-events: write
  pull-requests: write

jobs:
  repovista:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install RepoVista
        run: npm install -g repovista

      - name: Run RepoVista
        run: repovista audit --ci --pr --run-checks --audit-profile pr-review --export sarif,github,jsonl,html

      - name: Upload RepoVista report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: repovista-report
          path: .repovista/

      - name: Upload SARIF
        if: always() && hashFiles('.repovista/**/findings.sarif') != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .repovista
`;

export async function runCiInitCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "repovista.yml");
  if (options.dryRun) {
    return `RepoVista GitHub Actions workflow dry run: ${workflowPath}\n\n${WORKFLOW}`;
  }

  if (!options.force && await pathExists(workflowPath)) {
    throw new RepoVistaError(`RepoVista workflow already exists: ${workflowPath}. Re-run with --force to overwrite.`);
  }

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, WORKFLOW, "utf8");
  return `Created RepoVista GitHub Actions workflow: ${workflowPath}\n`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}
