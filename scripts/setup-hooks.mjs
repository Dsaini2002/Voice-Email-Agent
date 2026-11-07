// Runs automatically on `npm install`: turns on the secret-check git hook.
import { execSync } from "node:child_process";
try {
  execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
  console.log("🔒 Secret-check git hook enabled (.githooks/pre-commit).");
} catch {
  // Not a git repository (e.g. downloaded as ZIP) — nothing to do.
}
