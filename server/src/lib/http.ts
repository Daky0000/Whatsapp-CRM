import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { HttpError } from "./errors.js";

export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input.");
  }
  return result.data;
}

/** Express 4 types params as string; this keeps route code free of casts. */
export const param = (req: Request, name: string) => String(req.params[name]);
