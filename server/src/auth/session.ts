import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { config, isProd } from "../config.js";
import { users } from "../db.js";

export const SESSION_COOKIE = "vm_session";
const SESSION_DAYS = 7;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: ObjectId;
      viaExtension?: boolean;
    }
  }
}

export function setSession(res: Response, userId: ObjectId): void {
  const token = jwt.sign({ sub: userId.toHexString() }, config.SESSION_SECRET, {
    expiresIn: `${SESSION_DAYS}d`,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript cannot read it (XSS protection)
    secure: isProd, // HTTPS only in production
    sameSite: "lax", // CSRF protection for state-changing requests
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Accepts either the dashboard's session cookie or the Chrome extension's
 * bearer token ("Authorization: Bearer <token>"). Only a SHA-256 hash of the
 * extension token is stored, so a database leak does not reveal it.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1];
  if (bearer) {
    const u = await users().findOne({ extTokenHash: hashToken(bearer) }, { projection: { _id: 1 } });
    if (!u?._id) {
      res.status(401).json({ error: "Extension not connected. Open the dashboard to reconnect." });
      return;
    }
    req.userId = u._id;
    req.viaExtension = true;
    next();
    return;
  }
  requireSession(req, res, next);
}

/** Cookie session only (used for endpoints the extension must not call, e.g. issuing tokens). */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.SESSION_SECRET) as { sub: string };
    req.userId = new ObjectId(payload.sub);
    next();
  } catch {
    clearSession(res);
    res.status(401).json({ error: "Session expired" });
  }
}
