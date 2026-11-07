// Bundles the extension with esbuild and copies fonts. Output: extension/dist + extension/fonts
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const watch = process.argv.includes("--watch");

mkdirSync("fonts", { recursive: true });
for (const [pkg, file] of [
  ["@fontsource/orbitron", "orbitron-latin-500-normal.woff2"],
  ["@fontsource/orbitron", "orbitron-latin-700-normal.woff2"],
  ["@fontsource/rajdhani", "rajdhani-latin-500-normal.woff2"],
  ["@fontsource/rajdhani", "rajdhani-latin-600-normal.woff2"],
  ["@fontsource/rajdhani", "rajdhani-latin-700-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-500-normal.woff2"],
]) {
  const dir = path.dirname(require.resolve(`${pkg}/package.json`));
  copyFileSync(path.join(dir, "files", file), path.join("fonts", file));
}

const options = {
  entryPoints: { gmail: "src/gmail/main.ts", connect: "src/connect.ts", background: "src/background.ts", popup: "src/popup.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};
// Content scripts cannot be ES modules — build them as IIFE.
const iife = { ...options, entryPoints: { gmail: "src/gmail/main.ts", connect: "src/connect.ts" }, format: "iife" };
const esm = { ...options, entryPoints: { background: "src/background.ts", popup: "src/popup.ts" } };

if (watch) {
  for (const o of [iife, esm]) await (await context(o)).watch();
} else {
  await build(iife);
  await build(esm);
}
