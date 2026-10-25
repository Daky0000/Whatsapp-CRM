import { prisma } from "../db.js";
import { hashPassword } from "../lib/crypto.js";
import { normalizePhone } from "../lib/phone.js";

/**
 * The DakyXTech owner account, created from the environment at start-up,
 * because this repository is public and a password must never be in it:
 *
 *   OWNER_EMAIL, OWNER_PASSWORD   required to do anything
 *   OWNER_NAME, OWNER_USERNAME, OWNER_PHONE, OWNER_BUSINESS   optional
 *
 * Runs on every boot and is idempotent. The password is set only when the
 * account is first created; after that it belongs to the owner, and a restart
 * must not undo a password they changed. The workspace is comped: Pro, active,
 * with no end date the scheduler would expire.
 */
const COMPED_UNTIL = new Date("2099-12-31T00:00:00Z");

export function normalizeUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase();
  // Letters first, so a username can never be mistaken for a phone number at sign-in.
  return /^[a-z][a-z0-9._-]{2,31}$/.test(u) ? u : null;
}

export async function ensureOwner(): Promise<void> {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;

  const givenName = process.env.OWNER_NAME?.trim() || null;
  const username = process.env.OWNER_USERNAME ? normalizeUsername(process.env.OWNER_USERNAME) : null;
  const phone = process.env.OWNER_PHONE ? normalizePhone(process.env.OWNER_PHONE) : null;
  if (process.env.OWNER_USERNAME && !username) console.warn("[owner] OWNER_USERNAME must be 3–32 letters, digits, . _ or -, starting with a letter; ignored.");
  if (process.env.OWNER_PHONE && !phone) console.warn("[owner] OWNER_PHONE isn't a valid number; ignored.");

  // Don't take a username or phone another account already holds.
  const clash = async (field: "username" | "phone", value: string | null) =>
    value ? !!(await prisma.user.findFirst({ where: { [field]: value, NOT: { email } }, select: { id: true } })) : false;
  const safeUsername = (await clash("username", username)) ? (console.warn("[owner] username already taken; skipped."), null) : username;
  const safePhone = (await clash("phone", phone)) ? (console.warn("[owner] phone already used by another account; skipped."), null) : phone;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        platformAdmin: true,
        role: "OWNER",
        // Only what's actually set: an unset variable must not overwrite a real name with a default.
        ...(givenName ? { name: givenName } : {}),
        ...(safeUsername ? { username: safeUsername } : {}),
        ...(safePhone ? { phone: safePhone, phoneVerifiedAt: existing.phoneVerifiedAt ?? new Date() } : {}),
      },
    });
    await prisma.workspace.update({ where: { id: existing.workspaceId }, data: { plan: "PRO", status: "ACTIVE", currentPeriodEnd: COMPED_UNTIL } });
    return;
  }

  if (password.length < 8) console.warn("[owner] OWNER_PASSWORD is shorter than the 8 characters sellers must use. Change it after signing in.");
  await prisma.user.create({
    data: {
      email,
      name: givenName ?? "DakyXTech Owner",
      username: safeUsername,
      phone: safePhone,
      phoneVerifiedAt: safePhone ? new Date() : null,
      passwordHash: await hashPassword(password),
      role: "OWNER",
      platformAdmin: true,
      workspace: {
        create: {
          name: process.env.OWNER_BUSINESS?.trim() || "DakyXTech",
          plan: "PRO",
          status: "ACTIVE",
          currentPeriodEnd: COMPED_UNTIL,
          billingEmail: email,
        },
      },
    },
  });
  console.log(`[owner] Created the owner account for ${email}.`);
}
