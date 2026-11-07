import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { config, isProd } from "../config.js";

export const SESSION_COOKIE = "vm_session";
const SESSION_DAYS = 7;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: ObjectId;
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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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
