import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { authRouter } from "./auth/routes.js";
import { isProd } from "./config.js";
import { apiRouter } from "./routes/api.js";

export function createApp() {
  const app = express();
  if (isProd) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
          connectSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api", authRouter);
  app.use("/api", apiRouter);

  // In production the server also serves the built dashboard (web/dist).
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("/{*splat}", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}
