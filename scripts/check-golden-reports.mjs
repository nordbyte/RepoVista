import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractStructuredPhaseReport,
  validateReportQuality
} from "../dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "test", "fixtures", "golden-report-run");
const reports = [
  ["architecture", "01-architecture-report.md"],
  ["code-quality", "02-code-quality-report.md"],
  ["risk-and-bug", "03-risk-and-bug-report.md"],
  ["feature-roadmap", "04-feature-roadmap.md"],
  ["summary", "index.md"]
];

let failed = false;
for (const [phaseId, fileName] of reports) {
  const markdown = await readFile(path.join(fixtureDir, fileName), "utf8");
  const quality = validateReportQuality(phaseId, markdown);
  const structured = extractStructuredPhaseReport(markdown, phaseId, fileName);
  if (!quality.passed || structured.warnings.length) {
    failed = true;
    console.error(`${fileName} failed golden validation`);
    for (const warning of [...quality.warnings, ...structured.warnings]) {
      console.error(`- ${warning}`);
    }
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Golden RepoVista report fixtures passed.");
}
