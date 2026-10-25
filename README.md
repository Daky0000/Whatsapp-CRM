# DakyX WhatsApp CRM

A WhatsApp inbox for Ghanaian sellers, part of the DakyXTech ecosystem, at **whatsapp.dakyx.com**. It connects a WhatsApp Business number, and AI sorts every chat (new lead, order, inquiry, complaint, follow-up, not business). It pulls orders out of conversations and drafts replies that the seller approves with one tap. It also covers contacts, broadcast lists and template broadcasts, keyword/away/welcome auto-replies, voice-note transcription, payment links in chat, analytics, a morning summary, and Paystack billing on two plans (GHS 50 Starter, GHS 150 Pro).

**Read the plan first:** [`docs/PLAN.md`](docs/PLAN.md) ([PDF](docs/DakyX-WhatsApp-CRM-Plan.pdf)). It explains what WhatsApp does and doesn't allow, and why the product is shaped this way.

## Stack

Same as DakyXTech OS: Node 22 + Express + TypeScript, PostgreSQL via Prisma, React + Vite + Tailwind client built into `server/client/dist` and served by the same process. Claude (Anthropic SDK) for the AI, Meta's WhatsApp Cloud API, Paystack.

```
server/
  prisma/schema.prisma     data model
  src/lib/                 talks to one outside thing each: whatsapp, paystack, ai, chatExport, plans, phone, crypto
  src/services/            the rules: inbound webhook handling, triage, sending (24h window), broadcasts + wallet, billing, scheduler
  src/routes/              HTTP API (all JSON, cookie session)
  client/                  React app
  checks/                  tests (no database, no network): npm test
docs/                      plan + PDF (python3 docs/build_pdf.py regenerates it)
```

## Running it locally

```bash
cd server
cp .env.example .env          # fill SESSION_SECRET and ENCRYPTION_KEY (openssl rand -hex 32)
npm install && npm --prefix client install
npx prisma migrate dev        # needs Postgres at DATABASE_URL
npm run dev                   # API on :8080
npm --prefix client run dev   # UI on :5173, proxied to the API
npm test                      # unit checks
```

Without `ANTHROPIC_API_KEY`, everything works except AI sorting and drafts. Without Meta credentials, use **Settings → Start with chat exports** and import `.txt` exports from the Inbox. Replies then open in WhatsApp as `wa.me` links.

## Deploying to whatsapp.dakyx.com

**Settings the OS already has are reused, not duplicated.** This app reads the same environment variable names as DakyXTech OS for Paystack, Anthropic, email and the OS's WhatsApp number. The OS reads environment variables *before* its own settings table, so the clean set-up is: put those values in the Railway project's **Shared Variables** (or reference the OS service, e.g. `${{OS.SMTP_HOST}}`), and both services read the same ones. Change a password once, and both pick it up. `server/.env.example` marks which variables are shared and which aren't.

1. **Railway**: new service from this repo, **Root Directory `server`** (so `server/railway.json` applies), add a Postgres plugin, and set this app's own variables (`DATABASE_URL`, `PUBLIC_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `META_*`) plus the shared ones.
2. **Domain**: add `whatsapp.dakyx.com` as a custom domain in Railway, then add the `CNAME` it gives you at the DNS host for dakyx.com (Hostinger). Don't touch MX/SPF/DKIM/DMARC records.
3. **Paystack (shared with the OS)**: `PAYSTACK_SECRET_KEY`, `PAYSTACK_TEST_SECRET_KEY`, `PAYSTACK_MODE`. The OS's `PAYSTACK_CALLBACK_URL` is deliberately **not** read: it points at os.dakyx.com, so buyers return to `PUBLIC_URL/billing` instead. Plans are created in Paystack on the first checkout (or set `PAYSTACK_PLAN_STARTER` / `PAYSTACK_PLAN_PRO`).
   - **Webhooks:** Paystack sends events to **one URL per account**, and that URL is the OS's. One-off MoMo/card payments don't need it: they are verified when the buyer returns and re-checked every 10 minutes. **Automatic card renewals do.** Add a forward in the OS's Paystack webhook handler: pass any event whose `data.metadata.product === "whatsapp-crm"`, whose `data.reference` starts with `wcrm-`, or whose `data.plan.name` starts with `WhatsApp CRM`, unchanged (same body bytes and `x-paystack-signature`), to `https://whatsapp.dakyx.com/webhooks/paystack`.
4. **Meta / WhatsApp** (see the plan, section 2.1, for the approval path):
   - Meta app with the WhatsApp product; `META_APP_ID`, `META_APP_SECRET`.
   - Webhook callback `https://whatsapp.dakyx.com/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`. Subscribe to the fields `messages`, `smb_message_echoes`, `history` and `smb_app_state_sync` (the last three are for Coexistence numbers).
   - Facebook Login for Business configuration for Embedded Signup → `META_CONFIG_ID`. Until App Review and Tech Provider status are approved, sellers use chat-export mode, and you can test with Meta's test number through **Settings → Advanced: API token**.
5. **Email (shared with the OS)**: the OS's mail settings, under the same names: `MAIL_TRANSPORT` and either the `SMTP_*` set or the Hostinger token set (`HOSTINGER_MAIL_TOKEN`, `HOSTINGER_MAILBOX_ID`, `HOSTINGER_MAILBOX_ADDRESS`), plus `MAIL_FROM_NAME` / `MAIL_FROM_EMAIL`. Used for password-reset links and the morning summary; without them, both fall back to phone codes and the dashboard.
6. **Phone codes**: sign-up verifies the seller's phone (which also limits free trials to one per number), sign-in takes an email or a phone, and forgotten passwords go by code or email link.
   - **SMS and voice call: Vynfy, as in laluxury (nobleenclave.com)**: `VYNFY_API_KEY`, and `VYNFY_SENDER_ID=DakyXTech` (the registered sender ID, and the default).
   - **WhatsApp: the OS's own number**: `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` (shared with the OS), plus `WHATSAPP_OTP_TEMPLATE`, the name of an approved **Authentication** template with a copy-code button on that number. Vynfy has no WhatsApp delivery, so this channel's codes are made and checked here (hashed, 5 minutes, 3 tries). It only appears once the template is set.
   - In production, sign-up is refused until at least one channel is configured.
7. **Voice notes (Pro)**: `TRANSCRIBE_API_KEY` from Deepgram (default) or OpenAI (`TRANSCRIBE_PROVIDER=openai`). Without it, voice notes still play in the inbox; they just aren't turned into text.
8. **Owner account**: set `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME`, `OWNER_USERNAME` and `OWNER_PHONE` in Railway (never in this public repo). On start-up the server creates that account once: free Pro with no end date, and **All workspaces** in the menu to see every seller and extend anyone's access. The password is only used at creation; change it afterwards under Settings → Your password, and later restarts leave it alone. The owner signs in with the username, phone or email.
9. **AI (shared with the OS)**: `ANTHROPIC_API_KEY`. `AI_TRIAGE_MODEL` / `AI_DRAFT_MODEL` default to `claude-opus-5-5`. For margin on the Starter plan, consider `claude-haiku-5-5` for triage (see the plan, section 4.1).

## Rules the code depends on

- **The 24-hour window.** Free-form replies only within 24 hours of the customer's last message (`Conversation.lastInboundAt`), re-checked at send time. After that, only an approved template. Follow-up reminders are timed for 18–23 hours after the customer's last message, for this reason.
- **Nothing is sent by the AI on its own.** Drafts wait for a person. A `wa.me` draft stays "ready" until the seller confirms they sent it.
- **Every webhook is signature-checked over raw bytes** (Meta: HMAC-SHA256 with the app secret; Paystack: HMAC-SHA512 with the secret key). That is why `/webhooks` is mounted above the JSON parser.
- **Pesewas everywhere money crosses Paystack**, through `toPesewas`.
- **Meta's message fees come from the wallet, never the plan.** Plan limits on broadcasts protect the number's quality rating.
- **Phone numbers are identities.** `normalizePhone` refuses rather than guesses.
- **Payment links use the seller's own Paystack key**, never DakyXTech's, so customer money never passes through us. A link is only put in the reply box; the seller sends it. Payment is confirmed with Paystack (seller's webhook at `/webhooks/paystack-merchant/<workspaceId>`, or the 10-minute re-check), never from a redirect.
