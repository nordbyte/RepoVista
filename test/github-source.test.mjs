import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeGithubRepository, prepareGithubSource, validateGithubRef } from "../dist/index.js";

const SHA = "1111111111111111111111111111111111111111";
const TAG_SHA = "2222222222222222222222222222222222222222";

test("normalizes supported public GitHub repository inputs", () => {
  assert.deepEqual(normalizeGithubRepository("nordbyte/RepoVista"), {
    owner: "nordbyte",
    repo: "RepoVista",
    repository: "nordbyte/RepoVista",
    url: "https://github.com/nordbyte/RepoVista.git"
  });
  assert.deepEqual(normalizeGithubRepository("https://github.com/nordbyte/RepoVista.git"), {
    owner: "nordbyte",
    repo: "RepoVista",
    repository: "nordbyte/RepoVista",
    url: "https://github.com/nordbyte/RepoVista.git"
  });
});

test("rejects unsafe GitHub repository and ref inputs", () => {
  assert.throws(() => normalizeGithubRepository("https://token@github.com/nordbyte/RepoVista"), /credentials/);
  assert.throws(() => normalizeGithubRepository("https://gitlab.com/nordbyte/RepoVista"), /github\.com/);
  assert.throws(() => normalizeGithubRepository("https://github.com/nordbyte/RepoVista/tree/main"), /repository root/);
  assert.throws(() => normalizeGithubRepository("../RepoVista"), /valid GitHub owner\/repo/);
  assert.throws(() => validateGithubRef("feature branch"), /safe branch/);
  assert.throws(() => validateGithubRef("../main"), /safe branch/);
});

test("prepares a default-branch GitHub source in the report output root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-github-source-"));
  try {
    const calls = [];
    const source = await prepareGithubSource(root, path.join(root, ".repovista"), {
      command: "audit",
      githubRepo: "nordbyte/RepoVista"
    }, {
      now: new Date("2026-05-21T10:00:00.000Z"),
      runCommand: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        if (args[0] === "ls-remote" && args.includes("--symref")) {
          return ok("ref: refs/heads/main\tHEAD\n1111111111111111111111111111111111111111\tHEAD\n");
        }
        if (args[0] === "clone") {
          return ok("");
        }
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return ok(`${SHA}\n`);
        }
        return ok("");
      }
    });

    assert.equal(source?.repository, "nordbyte/RepoVista");
    assert.equal(source?.ref, undefined);
    assert.equal(source?.defaultBranch, "main");
    assert.equal(source?.commit, SHA);
    assert.equal(source?.cloneDir, path.join(root, ".repovista", "sources", "github", "nordbyte", "RepoVista", SHA.slice(0, 12)));
    assert.equal(source?.fetchedAt, "2026-05-21T10:00:00.000Z");
    assert.ok(calls.some((call) => call.args[0] === "clone" && call.args.includes("--branch") && call.args.includes("main")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires --github-repo when --github-ref is set", async () => {
  await assert.rejects(
    prepareGithubSource("/tmp/project", "/tmp/project/.repovista", {
      command: "audit",
      githubRef: "main"
    }),
    /requires --github-repo/
  );
});

test("prepares a requested GitHub ref", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-github-ref-"));
  try {
    const calls = [];
    const source = await prepareGithubSource(root, path.join(root, ".repovista"), {
      command: "audit",
      githubRepo: "https://github.com/nordbyte/RepoVista",
      githubRef: "v0.4.0"
    }, {
      runCommand: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        if (args[0] === "ls-remote") {
          return ok(`${TAG_SHA}\trefs/tags/v0.4.0^{}\n`);
        }
        if (args[0] === "clone") {
          return ok("");
        }
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return ok(`${TAG_SHA}\n`);
        }
        return ok("");
      }
    });

    assert.equal(source?.ref, "v0.4.0");
    assert.equal(source?.commit, TAG_SHA);
    assert.equal(source?.cloneDir, path.join(root, ".repovista", "sources", "github", "nordbyte", "RepoVista", TAG_SHA.slice(0, 12)));
    assert.ok(calls.some((call) => call.args[0] === "clone" && call.args.includes("--branch") && call.args.includes("v0.4.0")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function ok(stdout) {
  return {
    command: "git",
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    stdout
  };
}
