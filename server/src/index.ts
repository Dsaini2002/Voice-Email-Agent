import path from "node:path";
import { analyzePending } from "./ai/analyzer.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb, connectDb, users } from "./db.js";
import { startScheduler } from "./gmail/scheduler.js";

const app = createApp();

async function main() {
  const kind = await connectDb();
  console.log(kind === "json" ? `✅ Storage: JSON files in ${path.resolve(config.DATA_DIR)}` : "✅ Storage: MongoDB connected");

  const server = app.listen(config.PORT, () => {
    console.log(`🚀 VaaniMail server running on http://localhost:${config.PORT}`);
  });

  startScheduler();

  // Resume analysis of anything left pending before the last shutdown.
  const all = await users().find({}, { projection: { _id: 1 } }).toArray();
  for (const u of all) void analyzePending(u._id);

  const shutdown = async () => {
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("❌ Server failed to start:", err.message);
  if (String(err.message).includes("ECONNREFUSED")) {
    console.error("   MONGODB_URI is set but MongoDB is not reachable. Remove MONGODB_URI from server/.env to use the built-in JSON storage.");
  }
  process.exit(1);
});
