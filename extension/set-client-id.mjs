// Owner setup: puts your Google OAuth Client ID into manifest.json.
// Usage: npm run set-client-id -w extension -- 1234567890-abc.apps.googleusercontent.com
import { readFileSync, writeFileSync } from "node:fs";

const id = (process.argv[2] ?? "").trim();
if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
  console.error('❌ Give the Client ID, e.g.:  npm run set-client-id -w extension -- 1234-abc.apps.googleusercontent.com');
  process.exit(1);
}
const m = JSON.parse(readFileSync("manifest.json", "utf8"));
m.oauth2.client_id = id;
writeFileSync("manifest.json", JSON.stringify(m, null, 2) + "\n");
console.log(`✅ Client ID saved in extension/manifest.json\n   Now run: npm run release -w extension`);
