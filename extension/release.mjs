// Builds the extension and copies ONLY the files Chrome needs into release/vaani-extension.
// Zip that folder and share it (or upload it to the Chrome Web Store).
import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";

execSync("node build.mjs", { stdio: "inherit" });
const out = "release/vaani-extension";
rmSync("release", { recursive: true, force: true });
for (const f of ["manifest.json", "popup.html", "icons", "dist", "fonts"]) cpSync(f, `${out}/${f}`, { recursive: true });
console.log(`\n✅ Ready: extension/${out}\n   • Test: chrome://extensions → Developer mode → Load unpacked → choose that folder\n   • Share: zip the folder and send it, or upload to the Chrome Web Store`);
