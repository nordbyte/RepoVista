import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { maskSensitiveText } from "./secrets.js";
import type { AuditOptions, EvidenceCommandResult, EvidencePack } from "./types.js";

export interface CommandRunOptions {
  cwd: string;
  timeoutSeconds: number;
  shell?: boolean;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions
) => Promise<EvidenceCommandResult>;

export interface EvidenceDependencies {
  runCommand?: CommandRunner;
}

const MAX_CAPTURED_OUTPUT = 4000;

export async function collectEvidence(
  projectRoot: string,
  options: AuditOptions,
  dependencies: EvidenceDependencies = {}
): Promise<EvidencePack> {
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const packageJson = await readPackageSummary(projectRoot);
  const npm = await runCommand("npm", ["--version"], { cwd: projectRoot, timeoutSeconds: 10 });
  const codex = await runCommand("codex", ["--version"], { cwd: projectRoot, timeoutSeconds: 10 });
  const git = await collectGitEvidence(projectRoot, runCommand);
  const configuredCommands = options.checkCommands ?? [];
  const checkTimeoutSeconds = options.checkTimeoutSeconds ?? 300;
  const commands = configuredCommands.length
    ? configuredCommands
    : detectDefaultCheckCommands(packageJson?.scripts);
  const checkResults = options.runChecks
    ? await runCheckCommands(projectRoot, commands, checkTimeoutSeconds, runCommand)
    : [];

  return {
    collectedAt: new Date().toISOString(),
    projectRoot,
    runtime: {
      node: process.version,
      npm: npm.exitCode === 0 ? (npm.stdout ?? "").trim() : "unavailable",
      platform: `${process.platform} ${process.arch} (${os.type()} ${os.release()})`
    },
    packageJson: packageJson
      ? {
          name: packageJson.name,
          version: packageJson.version,
          private: packageJson.private
        }
      : undefined,
    git,
    codex: {
      available: codex.exitCode === 0,
      version: codex.exitCode === 0 ? (codex.stdout ?? "").trim() : undefined,
      error: codex.exitCode === 0 ? undefined : codex.error ?? codex.stderr
    },
    checks: {
      enabled: options.runChecks,
      timeoutSeconds: checkTimeoutSeconds,
      commands,
      results: checkResults
    }
  };
}

export function renderEvidenceMarkdown(evidence: EvidencePack): string {
  return `## Evidence Pack

### Runtime

| Signal | Value |
|---|---|
| Node.js | ${escapeTableCell(evidence.runtime.node)} |
| npm | ${escapeTableCell(evidence.runtime.npm)} |
| Platform | ${escapeTableCell(evidence.runtime.platform)} |
| Collected at | ${escapeTableCell(evidence.collectedAt)} |

### Package

| Signal | Value |
|---|---|
| Name | ${escapeTableCell(evidence.packageJson?.name ?? "not detected")} |
| Version | ${escapeTableCell(evidence.packageJson?.version ?? "not detected")} |
| Private | ${escapeTableCell(evidence.packageJson?.private === undefined ? "not specified" : String(evidence.packageJson.private))} |

### Git

| Signal | Value |
|---|---|
| Repository detected | ${evidence.git.available ? "yes" : "no"} |
| Branch | ${escapeTableCell(evidence.git.branch ?? "not detected")} |
| Commit | ${escapeTableCell(evidence.git.commit ?? "not detected")} |
| Dirty working tree | ${evidence.git.dirty === undefined ? "unknown" : evidence.git.dirty ? "yes" : "no"} |
| Origin remote | ${escapeTableCell(evidence.git.remote ?? "not detected")} |

${renderGitStatus(evidence)}

### Codex CLI

| Signal | Value |
|---|---|
| Available | ${evidence.codex.available ? "yes" : "no"} |
| Version | ${escapeTableCell(evidence.codex.version ?? "not detected")} |
${evidence.codex.error ? `\nCodex error: \`${escapeInline(evidence.codex.error)}\`\n` : ""}
### Local Checks

${renderChecks(evidence)}
`;
}

export function hasFailedChecks(evidence: EvidencePack): boolean {
  return evidence.checks.results.some((result) => result.timedOut || result.exitCode !== 0 || Boolean(result.error));
}

async function collectGitEvidence(projectRoot: string, runCommand: CommandRunner): Promise<EvidencePack["git"]> {
  const inside = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot, timeoutSeconds: 10 });
  if (inside.exitCode !== 0 || inside.stdout?.trim() !== "true") {
    return {
      available: false,
      error: inside.error ?? inside.stderr
    };
  }

  const [branch, commit, status, remote] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { cwd: projectRoot, timeoutSeconds: 10 }),
    runCommand("git", ["rev-parse", "HEAD"], { cwd: projectRoot, timeoutSeconds: 10 }),
    runCommand("git", ["status", "--short"], { cwd: projectRoot, timeoutSeconds: 10 }),
    runCommand("git", ["remote", "get-url", "origin"], { cwd: projectRoot, timeoutSeconds: 10 })
  ]);
  const statusShort = status.stdout?.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean) ?? [];

  return {
    available: true,
    branch: cleanOutput(branch.stdout),
    commit: cleanOutput(commit.stdout),
    dirty: statusShort.length > 0,
    remote: cleanOutput(remote.stdout),
    statusShort
  };
}

async function readPackageSummary(projectRoot: string): Promise<{
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
} | undefined> {
  try {
    const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      name?: unknown;
      version?: unknown;
      private?: unknown;
      scripts?: unknown;
    };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      private: typeof parsed.private === "boolean" ? parsed.private : undefined,
      scripts: readStringRecord(parsed.scripts)
    };
  } catch {
    return undefined;
  }
}

function detectDefaultCheckCommands(scripts: Record<string, string> | undefined): string[] {
  if (!scripts) {
    return [];
  }

  const commands: string[] = [];
  for (const scriptName of ["typecheck", "lint", "test", "security:audit"]) {
    if (scripts[scriptName]) {
      commands.push(scriptName === "test" ? "npm test" : `npm run ${scriptName}`);
    }
  }
  return commands;
}

async function runCheckCommands(
  projectRoot: string,
  commands: string[],
  timeoutSeconds: number,
  runCommand: CommandRunner
): Promise<EvidenceCommandResult[]> {
  const results: EvidenceCommandResult[] = [];
  for (const command of commands) {
    results.push(await runCommand(command, [], {
      cwd: projectRoot,
      timeoutSeconds,
      shell: true
    }));
  }
  return results;
}

function defaultRunCommand(command: string, args: string[], options: CommandRunOptions): Promise<EvidenceCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      env: process.env,
      stdio: "pipe"
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 5000).unref();
    }, options.timeoutSeconds * 1000);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        command: renderCommand(command, args),
        exitCode: null,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: cleanCaptured(stdout),
        stderr: cleanCaptured(stderr),
        error: error.message
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        command: renderCommand(command, args),
        exitCode: code,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: cleanCaptured(stdout),
        stderr: cleanCaptured(stderr),
        error: timedOut ? `Command timed out after ${options.timeoutSeconds} seconds.` : undefined
      });
    });
  });
}

function renderChecks(evidence: EvidencePack): string {
  if (!evidence.checks.enabled) {
    const commands = evidence.checks.commands.length
      ? evidence.checks.commands.map((command) => `\`${command}\``).join(", ")
      : "none detected";
    return `Local checks were not run. Detected/default commands: ${commands}.`;
  }

  if (!evidence.checks.commands.length) {
    return "Local checks were enabled, but no check commands were detected or configured.";
  }

  const rows = [
    "| Command | Exit | Duration | Timeout |",
    "|---|---:|---:|---|",
    ...evidence.checks.results.map((result) => (
      `| \`${escapeTableCell(result.command)}\` | ${result.exitCode ?? "n/a"} | ${Math.round(result.durationMs)}ms | ${result.timedOut ? "yes" : "no"} |`
    ))
  ];
  const output = evidence.checks.results
    .filter((result) => result.stdout || result.stderr || result.error)
    .map((result) => renderCheckOutput(result))
    .join("\n\n");

  return `${rows.join("\n")}${output ? `\n\n${output}` : ""}`;
}

function renderCheckOutput(result: EvidenceCommandResult): string {
  const chunks = [`#### \`${result.command}\``];
  if (result.error) {
    chunks.push(`Error: ${result.error}`);
  }
  if (result.stdout) {
    chunks.push(`stdout:\n\n\`\`\`text\n${truncate(result.stdout)}\n\`\`\``);
  }
  if (result.stderr) {
    chunks.push(`stderr:\n\n\`\`\`text\n${truncate(result.stderr)}\n\`\`\``);
  }
  return chunks.join("\n\n");
}

function renderGitStatus(evidence: EvidencePack): string {
  if (!evidence.git.statusShort?.length) {
    return "Git status: clean or unavailable.";
  }

  const visible = evidence.git.statusShort.slice(0, 80).map((line) => `- \`${escapeInline(line)}\``);
  if (evidence.git.statusShort.length > visible.length) {
    visible.push(`- ... ${evidence.git.statusShort.length - visible.length} additional status entries omitted`);
  }
  return `Git status entries:\n\n${visible.join("\n")}`;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      record[key] = item;
    }
  }
  return record;
}

function cleanOutput(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function cleanCaptured(value: string): string | undefined {
  const cleaned = maskSensitiveText(value.trim());
  return cleaned || undefined;
}

function appendBounded(current: string, addition: string): string {
  const next = current + addition;
  return next.length <= MAX_CAPTURED_OUTPUT ? next : next.slice(next.length - MAX_CAPTURED_OUTPUT);
}

function truncate(value: string): string {
  return value.length <= MAX_CAPTURED_OUTPUT ? value : `${value.slice(0, MAX_CAPTURED_OUTPUT)}\n... truncated ...`;
}

function renderCommand(command: string, args: string[]): string {
  return [command, ...args].filter(Boolean).join(" ");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeInline(value: string): string {
  return value.replace(/`/g, "\\`").replace(/\n/g, " ");
}
