import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepoVistaError } from "./errors.js";
import type { AuditOptions } from "./types.js";

const WORKFLOWS: Record<NonNullable<AuditOptions["ciTemplate"]>, string> = {
  "pr-light": `name: RepoVista

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

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

      - name: Verify RepoVista provider
        run: repovista providers test codex

      - name: Run RepoVista
        run: repovista audit --ci --pr --no-run-checks --audit-profile pr-review --export jsonl,html --fail-on-drift --fail-on-weak-evidence --min-quality-score 70 --max-critical 0 --max-high 0

      - name: Upload RepoVista report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: repovista-report
          path: .repovista/
`,
  security: `name: RepoVista Security

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  security-events: write

jobs:
  repovista-security:
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

      - name: Run RepoVista security audit
        run: repovista audit --ci --audit-profile security --run-checks --strict-reports --export sarif,html,jsonl,github --fail-on-critical --fail-on-drift --fail-on-weak-evidence --min-quality-score 75 --max-critical 0

      - name: Upload RepoVista report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: repovista-security-report
          path: .repovista/
`,
  "release-readiness": `name: RepoVista Release Readiness

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  repovista-release-readiness:
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

      - name: Run release-readiness audit
        run: repovista audit --ci --audit-profile release-readiness --snapshot --run-checks --strict-reports --repair-reports --export sarif,html,jsonl --fail-on-drift --fail-on-weak-evidence --min-quality-score 80 --max-critical 0 --max-high 0

      - name: Upload RepoVista report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: repovista-release-readiness
          path: .repovista/
`,
  "scheduled-audit": `name: RepoVista Scheduled Audit

on:
  schedule:
    - cron: "17 3 * * 1"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  repovista-scheduled:
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

      - name: Run scheduled RepoVista audit
        run: repovista audit --ci --snapshot --incremental --audit-profile security --run-checks --export html,jsonl --fail-on-weak-evidence --min-quality-score 70 --max-critical 0

      - name: Upload RepoVista report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: repovista-scheduled-audit
          path: .repovista/
`
};

export async function runCiInitCommand(options: AuditOptions, projectRoot = process.cwd()): Promise<string> {
  const workflowPath = path.join(projectRoot, ".github", "workflows", "repovista.yml");
  const template = options.ciTemplate ?? "pr-light";
  const workflow = WORKFLOWS[template];
  if (options.dryRun) {
    return `RepoVista GitHub Actions workflow dry run (${template}): ${workflowPath}\n\n${workflow}`;
  }

  if (!options.force && await pathExists(workflowPath)) {
    throw new RepoVistaError(`RepoVista workflow already exists: ${workflowPath}. Re-run with --force to overwrite.`);
  }

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, workflow, "utf8");
  return `Created RepoVista GitHub Actions workflow (${template}): ${workflowPath}\n`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}
