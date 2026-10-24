import { HttpError } from "./errors.js";

/**
 * Fixed-window counters in memory. One instance is assumed (as for the
 * scheduler); a restart forgets the counts, which only ever errs towards
 * letting a real person in.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function hit(key: string, limit: number, windowMs: number, message = "Too many attempts. Please wait a few minutes and try again."): void {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
  } else if (++w.count > limit) {
    throw new HttpError(429, message, "rate_limited");
  }
  if (windows.size > 50_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
}

export const MINUTE = 60_000;
