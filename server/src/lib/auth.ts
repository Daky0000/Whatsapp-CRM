import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { hmacHex, safeEqualHex } from "./crypto.js";
import { HttpError } from "./errors.js";

export const SESSION_COOKIE = "wcrm_session";
const SESSION_DAYS = 30;

/** "<userId>.<expiry ms>.<hmac>" — stateless, signed with SESSION_SECRET. */
export function issueSession(res: Response, userId: string) {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${userId}.${expires}`;
  const token = `${payload}.${hmacHex("sha256", config.sessionSecret(), payload)}`;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.production,
    expires: new Date(expires),
    path: "/",
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function readSession(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const [userId, expires, signature] = token.split(".");
  if (!userId || !expires || !signature) return null;
  if (!safeEqualHex(signature, hmacHex("sha256", config.sessionSecret(), `${userId}.${expires}`))) return null;
  if (Number(expires) < Date.now()) return null;
  return userId;
}

export interface AuthedRequest extends Request {
  user: { id: string; email: string; name: string; role: "OWNER" | "AGENT"; workspaceId: string };
}

export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const userId = readSession(req.cookies?.[SESSION_COOKIE]);
    if (!userId) throw new HttpError(401, "Please sign in.");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, workspaceId: true },
    });
    if (!user) throw new HttpError(401, "Please sign in.");
    (req as AuthedRequest).user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if ((req as AuthedRequest).user?.role !== "OWNER") return next(new HttpError(403, "Only the workspace owner can do that."));
  next();
}

export const ws = (req: Request) => (req as AuthedRequest).user.workspaceId;
export const me = (req: Request) => (req as AuthedRequest).user;
