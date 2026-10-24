import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ws } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { h, param, parse } from "../lib/http.js";
import { normalizePhone } from "../lib/phone.js";
import { billingOf } from "../services/usage.js";

export const contactsRouter = Router();

async function assertContactRoom(workspaceId: string, adding: number) {
  const { limits } = await billingOf(workspaceId);
  const count = await prisma.contact.count({ where: { workspaceId } });
  if (count + adding > limits.contacts) {
    throw new HttpError(402, `Your plan holds ${limits.contacts.toLocaleString()} contacts (you have ${count.toLocaleString()}). Upgrade to Pro for more.`);
  }
}

contactsRouter.get(
  "/contacts",
  h(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const label = typeof req.query.label === "string" ? req.query.label : "";
    const contacts = await prisma.contact.findMany({
      where: {
        workspaceId: ws(req),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } : {}),
        ...(label ? { labels: { has: label } } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
      include: { listMembers: { select: { listId: true } } },
    });
    res.json(contacts.map(({ listMembers, ...c }) => ({ ...c, listIds: listMembers.map((m) => m.listId) })));
  }),
);

const ContactInput = z.object({
  phone: z.string().min(6),
  name: z.string().trim().max(120).nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: z.string().max(2000).nullable().optional(),
  optedIn: z.boolean().optional(),
  optedOut: z.boolean().optional(),
});

contactsRouter.post(
  "/contacts",
  h(async (req, res) => {
    const body = parse(ContactInput, req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, "That doesn't look like a valid phone number. Use a format like 024 123 4567 or +233 24 123 4567.");
    if (await prisma.contact.findUnique({ where: { workspaceId_phone: { workspaceId: ws(req), phone } } })) {
      throw new HttpError(409, "A contact with that number already exists.");
    }
    await assertContactRoom(ws(req), 1);
    const contact = await prisma.contact.create({ data: { ...body, phone, workspaceId: ws(req) } });
    res.status(201).json(contact);
  }),
);

contactsRouter.patch(
  "/contacts/:id",
  h(async (req, res) => {
    const { phone: _ignored, ...data } = parse(ContactInput.partial(), req.body);
    const updated = await prisma.contact.updateMany({ where: { id: param(req, "id"), workspaceId: ws(req) }, data });
    if (!updated.count) throw new HttpError(404, "Contact not found.");
    res.json({ ok: true });
  }),
);

contactsRouter.delete(
  "/contacts/:id",
  h(async (req, res) => {
    const removed = await prisma.contact.deleteMany({ where: { id: param(req, "id"), workspaceId: ws(req) } });
    if (!removed.count) throw new HttpError(404, "Contact not found.");
    res.json({ ok: true });
  }),
);

/** Minimal CSV: handles quoted fields and commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const ImportCsv = z.object({ csv: z.string().min(1).max(2_000_000), label: z.string().trim().max(40).optional() });

contactsRouter.post(
  "/contacts/import",
  h(async (req, res) => {
    const { csv, label } = parse(ImportCsv, req.body);
    const rows = parseCsv(csv);
    const header = rows[0]?.map((c) => c.trim().toLowerCase()) ?? [];
    const phoneCol = header.findIndex((c) => /phone|number|mobile|whatsapp|tel/.test(c));
    const nameCol = header.findIndex((c) => /name/.test(c));
    const hasHeader = phoneCol >= 0;
    const body = hasHeader ? rows.slice(1) : rows;
    const pCol = hasHeader ? phoneCol : 1;
    const nCol = hasHeader ? nameCol : 0;

    const seen = new Set<string>();
    const valid: Array<{ phone: string; name: string | null }> = [];
    let invalid = 0;
    for (const r of body) {
      const phone = normalizePhone(r[pCol] ?? r[0] ?? "");
      if (!phone) {
        invalid++;
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      valid.push({ phone, name: (nCol >= 0 ? r[nCol]?.trim() : null) || null });
    }
    const existing = new Set(
      (await prisma.contact.findMany({ where: { workspaceId: ws(req), phone: { in: valid.map((v) => v.phone) } }, select: { phone: true } })).map((c) => c.phone),
    );
    const fresh = valid.filter((v) => !existing.has(v.phone));
    await assertContactRoom(ws(req), fresh.length);
    await prisma.contact.createMany({
      data: fresh.map((v) => ({ workspaceId: ws(req), phone: v.phone, name: v.name, labels: label ? [label] : [] })),
      skipDuplicates: true,
    });
    res.json({ added: fresh.length, alreadyHad: valid.length - fresh.length, invalid });
  }),
);

contactsRouter.get(
  "/contacts/export.csv",
  h(async (req, res) => {
    const contacts = await prisma.contact.findMany({ where: { workspaceId: ws(req) }, orderBy: { createdAt: "asc" } });
    const esc = (v: string | null) => `"${(v ?? "").replaceAll('"', '""')}"`;
    const lines = ["name,phone,labels,opted_in,opted_out,notes"].concat(
      contacts.map((c) => [esc(c.name), `+${c.phone}`, esc(c.labels.join("; ")), c.optedIn, c.optedOut, esc(c.notes)].join(",")),
    );
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="contacts.csv"');
    res.send(lines.join("\n"));
  }),
);
