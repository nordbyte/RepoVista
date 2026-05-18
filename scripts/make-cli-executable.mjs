import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const cliPath = join(process.cwd(), "dist", "cli.js");

if (existsSync(cliPath)) {
  chmodSync(cliPath, 0o755);
}
