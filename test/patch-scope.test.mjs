import test from "node:test";
import assert from "node:assert/strict";
import { parseGitStatusFiles } from "../dist/git-status.js";
import { evaluatePatchScope } from "../dist/patch-scope.js";

test("patch scope allows minimum-fix-scope files, helper auth files, docs, and tests", () => {
  const finding = adminAuthFinding();
  const result = evaluatePatchScope([finding], [
    "README.md",
    "client/src/lib/api.ts",
    "server/src/app.ts",
    "server/src/index.ts",
    "server/src/lib/auth.ts",
    "server/src/middleware/adminAuth.ts",
    "server/src/__tests__/routes/keys.test.ts"
  ], 12);

  assert.equal(result.passed, true);
  assert.ok(result.allowedPaths.includes("client/src/lib/api.ts"));
  assert.ok(result.allowedPaths.includes("server/src/middleware/"));
});

test("patch scope still rejects unrelated production files for single-finding PRs", () => {
  const result = evaluatePatchScope([adminAuthFinding()], [
    "server/src/app.ts",
    "server/src/routes/proxy.ts"
  ], 12);

  assert.equal(result.passed, false);
  assert.match(result.violations.join("\n"), /server\/src\/routes\/proxy\.ts/);
});

test("patch scope allows env examples and localized documentation hints", () => {
  const result = evaluatePatchScope([{
    id: "fnd_env_key",
    title: "Fallback key is stored beside encrypted API keys",
    severity: "medium",
    category: "security",
    status: "open",
    paths: ["server/src/lib/crypto.ts"],
    evidence: "ENCRYPTION_KEY fallback persists a key in local settings.",
    recommendation: "Make ENCRYPTION_KEY required in production.",
    minimumFixScope: "server/src/lib/crypto.ts und Start-/Env-Dokumentation."
  }], [
    ".env.example",
    "README.md",
    "server/src/lib/crypto.ts"
  ], 12);

  assert.equal(result.passed, true);
  assert.ok(result.allowedPaths.includes(".env.example"));
  assert.ok(result.allowedPaths.includes("README.md"));
});

test("patch scope allows tests from localized test hints", () => {
  const result = evaluatePatchScope([{
    id: "fnd_rate_limit",
    title: "Rate-limit state is lost on restart",
    severity: "medium",
    category: "reliability",
    status: "open",
    paths: ["server/src/services/ratelimit.ts"],
    evidence: "Rate limit state uses process-local maps.",
    recommendation: "Persist per-key usage and cooldown state.",
    suggestedRegressionTest: "Integrationstest mit temporärer DB ergänzen."
  }], [
    "server/src/__tests__/services/ratelimit.test.ts",
    "server/src/services/ratelimit.ts"
  ], 12);

  assert.equal(result.passed, true);
  assert.ok(result.allowedPaths.includes("server/src/__tests__/"));
});

test("git status parser includes tracked and untracked changed files", () => {
  assert.deepEqual(parseGitStatusFiles([
    " M src/index.ts",
    "A  src/new.ts",
    "?? test/new.test.ts",
    "R  src/old.ts -> src/renamed.ts",
    "!! ignored.log"
  ].join("\n")), [
    "src/index.ts",
    "src/new.ts",
    "src/renamed.ts",
    "test/new.test.ts"
  ]);
});

function adminAuthFinding() {
  return {
    id: "fnd_admin_auth",
    title: "Admin APIs expose key and routing controls without authentication while listening on all interfaces",
    severity: "high",
    category: "security",
    status: "open",
    paths: [
      "server/src/app.ts",
      "server/src/index.ts",
      "server/src/routes/fallback.ts",
      "server/src/routes/health.ts",
      "server/src/routes/keys.ts",
      "server/src/routes/settings.ts"
    ],
    evidence: "Admin API routes are mounted without middleware.",
    recommendation: "Add a shared admin-auth middleware before all non-public `/api/*` routes and document unsafe HOST exposure.",
    suggestedRegressionTest: "Add route tests for keys, fallback, health, and settings without admin auth.",
    minimumFixScope: "`server/src/app.ts`, a new or shared auth middleware, and client fetch calls in `client/src/lib/api.ts` / dashboard pages."
  };
}
