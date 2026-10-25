import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { requireUser } from "./lib/auth.js";
import { HttpError } from "./lib/errors.js";
import { adminRouter } from "./routes/admin.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { billingRouter } from "./routes/billing.js";
import { broadcastsRouter } from "./routes/broadcasts.js";
import { businessRouter } from "./routes/business.js";
import { contactsRouter } from "./routes/contacts.js";
import { automationRouter } from "./routes/automation.js";
import { inboxRouter } from "./routes/inbox.js";
import { settingsRouter } from "./routes/settings.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { ensureOwner } from "./services/owner.js";
import { startScheduler } from "./services/scheduler.js";

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Signed webhooks need the raw bytes, so they are mounted before the JSON parser.
app.use("/webhooks", webhooksRouter);

app.use(express.json({ limit: "6mb" }));
app.use(cookieParser());

// Session cookies are SameSite=Lax; refusing writes from another origin as well closes CSRF without tokens.
app.use("/api", (req, _res, next) => {
  const origin = req.header("origin");
  if (config.production && origin && req.method !== "GET" && req.method !== "HEAD" && hostOf(origin) !== req.header("host")) {
    return next(new HttpError(403, "Cross-site request refused."));
  }
  next();
});

app.use("/api/auth", authRouter);
const api = express.Router();
api.use(requireUser);
for (const router of [settingsRouter, whatsappRouter, inboxRouter, contactsRouter, broadcastsRouter, automationRouter, businessRouter, analyticsRouter, billingRouter, adminRouter]) {
  api.use(router);
}
app.use("/api", api);
app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found.")));

// The built React client.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "Invalid JSON." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

ensureOwner()
  .catch((err) => console.error("[owner] could not set up the owner account:", err))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`WhatsApp CRM listening on :${config.port}`);
      startScheduler();
    });
  });
