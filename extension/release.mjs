// Builds the extension and copies ONLY the files Chrome needs into release/vaani-extension.
// Zip that folder and share it (or upload it to the Chrome Web Store).
import { execSync } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";

const m = JSON.parse(readFileSync("manifest.json", "utf8"));
if (/PASTE_YOUR_CLIENT_ID/.test(m.oauth2?.client_id ?? "")) {
  console.warn("⚠  manifest.json still has no Google Client ID — users will not be able to sign in.\n   Run: npm run set-client-id -w extension -- <your-client-id>\n");
}
execSync("node build.mjs", { stdio: "inherit" });
const out = "release/vaani-extension";
rmSync("release", { recursive: true, force: true });
for (const f of ["manifest.json", "popup.html", "icons", "dist", "fonts"]) cpSync(f, `${out}/${f}`, { recursive: true });
console.log(`\n✅ Ready: extension/${out}\n   • Test: chrome://extensions → Developer mode → Load unpacked → choose that folder\n   • Share: zip the folder and send it, or upload to the Chrome Web Store`);
