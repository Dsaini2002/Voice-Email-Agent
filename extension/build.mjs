// Bundles the extension with esbuild and copies fonts. Output: extension/dist + extension/fonts
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const watch = process.argv.includes("--watch");
// VAANI_TEST=1 builds a test version that talks to a local mock of Google's APIs.
const TEST = process.env.VAANI_TEST === "1";

mkdirSync("fonts", { recursive: true });
for (const [pkg, file] of [
  ["@fontsource/sora", "sora-latin-600-normal.woff2"],
  ["@fontsource/sora", "sora-latin-700-normal.woff2"],
  ["@fontsource/space-grotesk", "space-grotesk-latin-400-normal.woff2"],
  ["@fontsource/space-grotesk", "space-grotesk-latin-500-normal.woff2"],
  ["@fontsource/space-grotesk", "space-grotesk-latin-600-normal.woff2"],
  ["@fontsource/space-grotesk", "space-grotesk-latin-700-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-500-normal.woff2"],
]) {
  const dir = path.dirname(require.resolve(`${pkg}/package.json`));
  copyFileSync(path.join(dir, "files", file), path.join("fonts", file));
}
// SQLite (WebAssembly) for the email history
mkdirSync("dist", { recursive: true });
copyFileSync(path.join(path.dirname(require.resolve("sql.js/package.json")), "dist", "sql-wasm.wasm"), path.join("dist", "sql-wasm.wasm"));

const options = {
  entryPoints: { gmail: "src/gmail/main.ts", background: "src/background.ts", popup: "src/popup.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  define: { __TEST__: TEST ? "true" : "false" },
  // sql.js only touches these in Node; in the browser they are never loaded
  external: ["fs", "path", "crypto"],
};
// Content scripts cannot be ES modules — build them as IIFE.
const iife = { ...options, entryPoints: { gmail: "src/gmail/main.ts" }, format: "iife" };
const esm = { ...options, entryPoints: { background: "src/background.ts", popup: "src/popup.ts" } };

if (watch) {
  for (const o of [iife, esm]) await (await context(o)).watch();
} else {
  await build(iife);
  await build(esm);
}
