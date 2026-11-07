#!/usr/bin/env node
/**
 * Secret scanner — stops API keys, passwords and .env files from reaching GitHub.
 *
 *   node scripts/check-secrets.mjs          → checks files staged for commit (used by the git pre-commit hook)
 *   node scripts/check-secrets.mjs --all    → checks every file in the repository  (npm run check-secrets)
 *
 * If something is found the commit is blocked and the file + line are shown.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ALL = process.argv.includes("--all");

const BLOCKED_FILES = [
  { re: /(^|\/)\.env(\..+)?$/, why: ".env file (secrets)", allow: /\.env\.example$/ },
  { re: /(^|\/)(client_secret|credentials)[^/]*\.json$/i, why: "Google credentials file" },
  { re: /service-account[^/]*\.json$|-sa-key[^/]*\.json$/i, why: "service account key" },
  { re: /\.(pem|key|p12|pfx)$/i, why: "private key / certificate" },
];

const PATTERNS = [
  { re: /AIza[0-9A-Za-z_\-]{35}/, why: "Google / Gemini API key" },
  { re: /GOCSPX-[0-9A-Za-z_\-]{20,}/, why: "Google OAuth client secret" },
  { re: /\b1\/\/0[0-9A-Za-z_\-]{30,}/, why: "Google refresh token" },
  { re: /ya29\.[0-9A-Za-z_\-]{30,}/, why: "Google access token" },
  { re: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, why: "private key" },
  { re: /mongodb(\+srv)?:\/\/[^\s:/@]+:[^\s@/]+@/, why: "MongoDB URL with password" },
  { re: /\bgh[pousr]_[0-9A-Za-z]{30,}/, why: "GitHub token" },
  { re: /\bsk-[A-Za-z0-9_\-]{20,}/, why: "API secret key (sk-…)" },
];

// KEY=value lines in any file: flag real-looking values for secret variable names.
const ENV_LINE = /^\s*(?:export\s+)?(GOOGLE_CLIENT_SECRET|GEMINI_API_KEY|ENCRYPTION_KEY|SESSION_SECRET|PUBSUB_VERIFICATION_TOKEN|MONGODB_URI)\s*=\s*(.+?)\s*$/;
const PLACEHOLDER = /^(|["']{2}|\.\.\..*|your-.*|<.*>|x{3,}.*|changeme|mongodb:\/\/localhost.*|mongodb:\/\/127\.0\.0\.1.*)$/i;

function listFiles() {
  try {
    const cmd = ALL ? "git ls-files -co --exclude-standard" : "git diff --cached --name-only --diff-filter=ACMR";
    return execSync(cmd, { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    // Not a git repo: walk the folder (skipping dependencies).
    const out = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".git", "dist"].includes(name)) continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(process.cwd(), p).split(path.sep).join("/"));
      }
    };
    walk(process.cwd());
    return out;
  }
}

function readContent(file) {
  try {
    // For commits, check exactly what is staged.
    if (!ALL) return execSync(`git show ":${file}"`, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

const problems = [];
for (const file of listFiles()) {
  for (const b of BLOCKED_FILES) {
    if (b.re.test(file) && !(b.allow && b.allow.test(file))) problems.push(`${file}: ${b.why} must never be committed`);
  }
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|pdf)$/i.test(file)) continue;
  const text = readContent(file);
  if (!text || text.includes("\u0000")) continue;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes("secret-scan:allow")) return;
    for (const p of PATTERNS) if (p.re.test(line)) problems.push(`${file}:${i + 1}: looks like a ${p.why}`);
    const m = line.match(ENV_LINE);
    if (m && !PLACEHOLDER.test(m[2])) problems.push(`${file}:${i + 1}: ${m[1]} has a real-looking value`);
  });
}

if (problems.length) {
  console.error("\n🚫 Secret check FAILED — ye cheezein GitHub par nahi jaani chahiye:\n");
  for (const p of [...new Set(problems)]) console.error("   • " + p);
  console.error("\n   Fix: secret ko file se hatao (sirf server/.env mein rakho), phir dobara commit karo.");
  console.error("   Agar galti se push ho chuka hai, to key turant badlo — SECURITY.md dekho.\n");
  process.exit(1);
}
console.log(`✅ Secret check passed (${ALL ? "all files" : "staged files"}).`);
