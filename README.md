# DakyX WhatsApp CRM

A WhatsApp inbox for Ghanaian sellers, part of the DakyXTech ecosystem, at **whatsappcrm.dakyx.com**. It connects a WhatsApp Business number, and AI sorts every chat (new lead, order, inquiry, complaint, follow-up, not business). It pulls orders out of conversations and drafts replies that the seller approves with one tap. It also covers contacts, broadcast lists and template broadcasts, keyword/away/welcome auto-replies, and Paystack billing on two plans (GHS 50 Starter, GHS 150 Pro).

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

## Deploying to whatsappcrm.dakyx.com

1. **Railway**: new service from this repo, **Root Directory `server`** (so `server/railway.json` applies), add a Postgres plugin and set the variables from `.env.example`.
2. **Domain**: add `whatsappcrm.dakyx.com` as a custom domain in Railway, then add the `CNAME` it gives you at the DNS host for dakyx.com (Hostinger). Don't touch MX/SPF/DKIM/DMARC records.
3. **Paystack**: give the service the **same** `PAYSTACK_SECRET_KEY` / `PAYSTACK_TEST_SECRET_KEY` / `PAYSTACK_MODE` as DakyXTech OS, and set `PAYSTACK_CALLBACK_URL=https://whatsappcrm.dakyx.com/billing`. Plans are created in Paystack automatically on the first checkout. Put existing plan codes in `PAYSTACK_PLAN_STARTER` / `PAYSTACK_PLAN_PRO` if you prefer.
   - **Webhooks:** Paystack sends events to **one URL per account**, and that URL is the OS's. Two things cover this. (a) The app verifies every payment when the buyer returns from checkout, and re-checks pending payments every 10 minutes, so one-off MoMo/card payments never depend on the webhook. (b) **Renewals charged automatically by a Paystack subscription do need the webhook.** Add a forward in the OS's Paystack webhook handler: pass any event whose `data.metadata.product === "whatsapp-crm"`, whose `data.reference` starts with `wcrm-`, or whose `data.plan.name` starts with `WhatsApp CRM`, unchanged (same body bytes and `x-paystack-signature` header), to `https://whatsappcrm.dakyx.com/webhooks/paystack`. This app ignores events that aren't its own.
4. **Meta / WhatsApp** (see the plan, section 2.1, for the approval path):
   - Meta app with the WhatsApp product; `META_APP_ID`, `META_APP_SECRET`.
   - Webhook callback `https://whatsappcrm.dakyx.com/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`. Subscribe to the fields `messages`, `smb_message_echoes`, `history` and `smb_app_state_sync` (the last three are for Coexistence numbers).
   - Facebook Login for Business configuration for Embedded Signup → `META_CONFIG_ID`. Until App Review and Tech Provider status are approved, sellers use chat-export mode, and you can test with Meta's test number through **Settings → Advanced: API token**.
5. **AI**: `ANTHROPIC_API_KEY`. `AI_TRIAGE_MODEL` / `AI_DRAFT_MODEL` default to `claude-opus-5-5`. For margin on the Starter plan, consider `claude-haiku-5-5` for triage (see the plan, section 4.1).

## Rules the code depends on

- **The 24-hour window.** Free-form replies only within 24 hours of the customer's last message (`Conversation.lastInboundAt`), re-checked at send time. After that, only an approved template. Follow-up reminders are timed for 18–23 hours after the customer's last message, for this reason.
- **Nothing is sent by the AI on its own.** Drafts wait for a person. A `wa.me` draft stays "ready" until the seller confirms they sent it.
- **Every webhook is signature-checked over raw bytes** (Meta: HMAC-SHA256 with the app secret; Paystack: HMAC-SHA512 with the secret key). That is why `/webhooks` is mounted above the JSON parser.
- **Pesewas everywhere money crosses Paystack**, through `toPesewas`.
- **Meta's message fees come from the wallet, never the plan.** Plan limits on broadcasts protect the number's quality rating.
- **Phone numbers are identities.** `normalizePhone` refuses rather than guesses.
