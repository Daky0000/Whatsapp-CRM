# DakyX WhatsApp CRM — Product & Build Plan

**Product:** DakyX WhatsApp CRM, part of the DakyXTech ecosystem
**Address:** `whatsappcrm.dakyx.com` (Railway, like `os.`, `app.` and `editor.`)
**Market:** Ghana first, then the rest of West Africa. Built for sellers whose orders arrive on WhatsApp.
**Payments:** Paystack in GHS, set up the same way as DakyXTech OS
**Version:** 1.0, 24 October 2026

---

## 1. The idea in one paragraph

Most sellers in Ghana take orders, questions and complaints on WhatsApp, not on a website. Their chats mix customers, family and spam, and replies slip through. DakyX WhatsApp CRM connects the seller's WhatsApp Business number and reads recent chats. AI sorts each chat (new lead, order, question, complaint, not business), saves the customer as a contact, and writes a reply that the seller approves with one tap. The same screen holds the seller's contacts, broadcast lists, automatic replies and follow-ups. There are two monthly plans: **GHS 50 (Starter)** and **GHS 150 (Pro)**.

## 2. Will it work? Yes, with three changes

The idea works. Three parts of it need to change because of how WhatsApp itself works. Each one is explained below.

### 2.1 "Connect your WhatsApp and scan recent chats"

WhatsApp gives no app access to a normal WhatsApp account's chats. There is no "allow this app to read my messages" button the way Google has for Gmail. There are only two legal ways in:

| Option | What it is | Verdict |
|---|---|---|
| **A. Official Cloud API + "Coexistence" (recommended)** | Meta's official WhatsApp Business Platform. With *Coexistence*, a seller already on the **WhatsApp Business app** links that number through Meta's Embedded Signup. They **keep using the app on their phone**. New messages flow to us both ways, and Meta syncs **up to about 6 months of 1:1 chat history** at connect time. | ✅ Official, safe, does what you described. **Needs a WhatsApp Business app number** (your instinct was right). Groups are not synced. |
| B. Chat export import | The seller exports a chat (WhatsApp → chat → *Export chat*) and uploads the `.txt`/`.zip`. We parse it and AI sorts it. | ✅ Works from day one with no Meta approval. Manual, one chat at a time. **We build this as the fallback.** |
| C. Unofficial "WhatsApp Web" robots (Baileys, whatsapp-web.js) | Scan a QR code and a robot pretends to be WhatsApp Web. | ❌ **Rejected.** It breaks WhatsApp's terms. Meta bans numbers that use it, and **a banned number is a seller's whole business gone**. One wave of bans would end the product's reputation. |

**What DakyXTech must do first (lead time 2–6 weeks):**
1. Verify the DakyXTech business in Meta Business Manager.
2. Create a Meta app and become a **Meta Tech Provider** (Meta's "Solution Partner" path for software that connects other businesses' numbers). If this takes too long, the shortcut is to onboard through a BSP such as 360dialog.
3. Pass App Review for `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Turn on Embedded Signup with Coexistence and history sync.
5. **Check Coexistence eligibility for Ghanaian numbers**. Meta has rolled it out by country and needs the Business app number to have some age and good standing. Until it is confirmed, sellers use route B, and route A goes live when it is.

### 2.2 "AI drafts a reply, then the user goes into WhatsApp to approve it"

Better: **approve it inside DakyX** and it sends through the API. With Coexistence, that sent message **also shows in the seller's WhatsApp app on their phone**, so nothing is hidden from them. Going back and forth between two apps is the step people stop doing.

For sellers on route B (no API), "Approve" opens WhatsApp with the reply already typed (a `wa.me` link). They press send, and the draft is marked sent only when they confirm it. This is the same pattern DakyXTech OS already uses.

**WhatsApp's 24-hour rule (non-negotiable):** a business can send free-form messages only within **24 hours of the customer's last message**. After that it can only send a **template** that Meta approved in advance. The app checks the window when you press send. When the window has closed, it suggests a re-engagement template instead.

### 2.3 Broadcasts, and the cost nobody mentions

WhatsApp broadcasts through the API must use **approved Marketing templates**, and **Meta charges per message delivered**. In Ghana's "Rest of Africa" rate band, that is roughly **US$0.02–0.03 per marketing message** (check Meta's live rate card before launch; it changes). Replies to customers inside the 24-hour window are free.

That means **broadcasts cannot be "unlimited" inside a GHS 50 plan**. 1,000 marketing messages cost about GHS 250–350 in Meta fees, which is more than the subscription. The fix:

- **The subscription pays for the software.**
- **A prepaid "Message Wallet"** (topped up with Paystack: MoMo, card or bank) pays Meta's per-message fee plus a small margin (suggested 15%). Before any broadcast goes out, the app shows *"This will cost about GHS 42.50 from your wallet"*.
- Each plan includes a few free broadcast credits, so new users can try it.

Broadcasts also need **opt-in**. Sending marketing to people who never agreed gets the number's quality rating marked RED, and then Meta limits it. So every contact has an opt-in status, a STOP reply opts someone out automatically, and broadcasts skip opted-out contacts.

### 2.4 "Even make audio if possible"

- **Voice notes in:** Phase 1 lets sellers play voice notes inside the inbox. Phase 2 **transcribes them into text**, so the AI can sort them like any other message. We use a speech-to-text provider, because Claude does not take audio input. Note: Twi, Ga and Ewe transcription quality is still limited; English and Pidgin are fine.
- **Voice calls (Phase 3):** Meta has a WhatsApp Business **Calling API**. Support for numbers on Coexistence and for Ghana must be confirmed, so it is planned for later rather than promised now.

## 3. Features

### 3.1 What you asked for (kept)
1. Connect a WhatsApp Business number (read and send).
2. Scan recent chats (with a limit per plan).
3. AI sorts each chat: **New lead · Order · Question/Inquiry · Complaint · Follow-up needed · Not business**.
4. AI writes a reply for each business chat, and the seller approves, edits or rejects it.
5. Save customers as contacts.
6. Broadcast lists, and broadcasts sent from the web app.
7. Automatic replies, plus automated messages to chosen contacts.
8. Paystack billing: GHS 50 and GHS 150 per month.

### 3.2 What I added (and why)

| Feature | Why it matters for a Ghanaian seller |
|---|---|
| **Order capture** | AI pulls out *item, quantity, size/colour, delivery location, price agreed* and creates an Order record. Turns chats into an order book. |
| **Pipeline board** | New → Negotiating → Ordered → Paid → Delivered, so the seller sees where money is stuck. |
| **Product catalogue and price list** | The AI drafts replies from the seller's real prices and stock, instead of making them up. The biggest quality lever. |
| **Business knowledge (FAQ)** | Delivery areas, fees, opening hours, return policy. The AI uses it to answer "do you deliver to Kumasi?" correctly. |
| **Brand voice settings** | Formal, friendly, or Ghanaian-casual ("Hello dear, it's available 👍🏾"). Replies sound like the seller. |
| **Follow-up reminders** | "Customer asked price 2 days ago and went quiet" → a nudge draft. This is where lost sales are recovered. |
| **Away / business-hours message** | An automatic reply at night, plus a summary in the morning. |
| **Keyword auto-replies** | "price", "location", "delivery" → instant answer (free inside the 24h window). |
| **Opt-in / STOP handling** | Protects the number's quality rating, so Meta doesn't limit the number. |
| **Voice-note transcription** | Voice notes become searchable and sortable text. |
| **CSV contact import/export** | Bring in existing customer lists; the seller can always take their data out. |
| **Labels and notes on contacts** | "VIP", "owes GHS 200", "wholesale". |
| **Team seats (Pro)** | Shop assistants answer chats under one number, and each reply records who sent it. |
| **Daily summary** | "12 new leads, 4 orders, 3 waiting for your reply." On the dashboard, and by email. |
| **Analytics** | Leads per day, reply time, conversion from chat to order, broadcast results. |
| **Message Wallet** | Pays Meta fees fairly (see 2.3). |
| **Payment links in chat (Phase 2)** | Send a Paystack/MoMo link for an order straight from the chat. The seller links their own Paystack account. |
| **Mobile app (Phase 3)** | Web first, as you said. Then a PWA, then a React Native app on the same API. |

## 4. Plans and limits

| | **Starter — GHS 50/month** | **Pro — GHS 150/month** |
|---|---|---|
| WhatsApp numbers | 1 | 1 (extra numbers: add-on later) |
| Team seats | 1 | 3 |
| History scan when connecting | Last **30 days**, up to **200 chats** | Last **6 months**, up to **2,000 chats** |
| AI sorting of conversations | 300 per month | 3,000 per month |
| AI reply drafts | 150 per month | 2,000 per month |
| Contacts | 500 | 10,000 |
| Broadcast lists | 2 | Unlimited |
| Broadcast recipients | 200/month (Meta fees from wallet) | 5,000/month (Meta fees from wallet) |
| Scheduled broadcasts | — | ✅ |
| Keyword auto-replies | 3 rules | Unlimited |
| Away message | ✅ | ✅ |
| Follow-up reminders | — | ✅ |
| Order capture and pipeline | View only | ✅ Full |
| Product catalogue for AI | 20 products | Unlimited |
| Voice-note transcription | — | ✅ (fair use 300 min) |
| Analytics | Basic | Full + export |
| Free broadcast credits | 50 messages | 300 messages |
| Support | Email | WhatsApp priority |

- **7-day free trial** of Pro, with no card needed, then the seller picks a plan.
- **Annual billing:** 2 months free (GHS 500 / GHS 1,500 per year), which suits sellers paying by MoMo.
- Billing uses **Paystack Plans and Subscriptions** (card renews automatically). MoMo users get a renewal invoice link each month, because MoMo can't be charged automatically.

### 4.1 Rough cost of serving one user per month

| | Starter | Pro |
|---|---|---|
| Revenue | GHS 50 | GHS 150 |
| Paystack fee (~1.95%) | ~GHS 1 | ~GHS 3 |
| AI (sorting + drafts, at the limits) | ~GHS 3–20 (depends on model) | ~GHS 15–60 |
| Hosting / storage share | ~GHS 3 | ~GHS 5 |
| Meta message fees | Paid from the wallet, not the plan | Paid from the wallet, not the plan |

The AI model is a settings choice (`AI_TRIAGE_MODEL`, `AI_DRAFT_MODEL`). The code defaults to Claude Opus 5.5 for quality. For margin on Starter, put sorting on Claude Haiku 5.5 (about 40× cheaper per token) and keep drafts on Opus. The usage limits above keep the worst case bounded either way.

## 5. How a message flows

```
Customer ──WhatsApp──> Meta Cloud API ──webhook──> whatsappcrm.dakyx.com
                                                     │
                       ┌─────────────────────────────┤
                       ▼                             ▼
             save message + contact        keyword auto-reply? -> send (free, 24h window)
                       │
                       ▼
          AI sorts chat (category, intent, order details, urgency)
                       │
             business? ├── no -> "Not business" tag, no draft
                       ▼
          AI writes reply from catalogue + FAQ + brand voice
                       │
                       ▼
         Seller sees it in the Inbox -> Approve / Edit / Reject
                       │
          window open? ├── yes -> send via API (shows in their phone app too)
                       └── no  -> offer an approved template / wa.me link
```

## 6. Technical design

Mirrors DakyXTech OS, so the same team can run both:

- **Server:** Node 22 + Express + TypeScript, **PostgreSQL via Prisma**.
- **Client:** React + Vite + Tailwind, built and served by the same server.
- **AI:** Anthropic Claude via the official SDK, with structured JSON output for sorting.
- **WhatsApp:** Meta Graph API (Cloud API). The webhook is checked against Meta's `X-Hub-Signature-256` over the raw request body.
- **Payments:** Paystack over `fetch`. It reads the **same Paystack keys and mode settings as DakyXTech OS** (`PAYSTACK_SECRET_KEY`, `PAYSTACK_TEST_SECRET_KEY`, `PAYSTACK_MODE`, `PAYSTACK_CALLBACK_URL`). The webhook is checked with HMAC-SHA512, amounts are in pesewas, and the currency is GHS.
- **Security:** each seller's WhatsApp access token is stored encrypted (AES-256-GCM). Every query is scoped to the seller's workspace. Passwords are hashed with scrypt. Sessions are HTTP-only cookies.
- **Hosting:** Railway service with custom domain `whatsappcrm.dakyx.com`, which needs a DNS `CNAME` to the Railway target. Don't touch the MX/SPF/DKIM records.

### Main data objects
Workspace (plan, trial, limits) · User · WhatsAppConnection · Contact · Conversation (category, stage, AI summary) · Message · Draft · Order · Product · KnowledgeItem · BroadcastList · Broadcast · BroadcastRecipient · AutoReplyRule · Subscription · Payment · WalletTransaction · UsageCounter.

## 7. Build phases

| Phase | Scope | Target |
|---|---|---|
| **0. Paperwork** | Meta business verification, Tech Provider / App Review, Paystack plans, DNS | Start now (2–6 weeks; runs alongside Phase 1) |
| **1. MVP** (this repository) | Sign-up and workspaces, Paystack plans and limits, WhatsApp connect (Embedded Signup + manual token), webhook inbox, chat-export import, AI sorting and order details, AI drafts with approve/edit/reject, contacts and CSV import, broadcast lists and template broadcasts, keyword and away auto-replies, STOP handling, dashboard | Weeks 1–6 |
| **2. Selling tools** (built, 25 Oct) | Pipeline board, follow-up reminders, message wallet top-ups, voice-note transcription, team seats, daily summary email, analytics, payment links in chat | Weeks 7–12 |
| **3. Reach** | PWA, then a mobile app; Calling API; several numbers per workspace; Twi/Pidgin tuning; integration with app.dakyx.com single sign-on | Month 4+ |

## 8. Found while building

- **Paystack has one webhook URL per account**, and the shared account's URL belongs to DakyXTech OS. One-off payments (MoMo or card) don't need it: the app verifies on return from checkout and re-checks pending payments every 10 minutes. **Automatic card renewals do.** The OS must forward WhatsApp CRM events to `whatsappcrm.dakyx.com/webhooks/paystack`; the README has the exact rule. The alternative is a separate Paystack account (or subaccount) for this product.
- **Follow-ups must go out inside the 24-hour window.** A nudge two days later can only be a paid template. So the follow-up reminder fires 18–23 hours after the customer's last message.
- **Chat exports carry no message ids.** The importer fingerprints each line, so importing the same file twice doesn't duplicate it.

## 9. Risks and how we handle them

| Risk | Handling |
|---|---|
| Meta approval is slow or Coexistence isn't available for Ghana yet | Ship chat-export import + `wa.me` sending first; the product is still useful. Use a BSP (360dialog) as the shortcut. |
| A seller's number gets a low quality rating from spammy broadcasts | Opt-in tracking, automatic STOP, broadcast limits per plan, quality rating shown in the app. |
| AI says something wrong (price, stock) | It never sends on its own in Phase 1. Everything is approved by a person. Drafts are built from the catalogue and FAQ. |
| Meta fees eat the subscription | The message wallet pays them, never the plan. |
| Customers' privacy | Data stays in each seller's workspace, with export and delete on request. A privacy policy covers the Ghana Data Protection Act 2012 (Act 843). |

## 10. Decisions I need from you

1. Will DakyXTech apply as a **Meta Tech Provider** (cheaper long-term) or start through a **BSP** like 360dialog (faster)?
2. Confirm the **wallet margin** (suggested 15%) and the **free trial** (7 days of Pro).
3. Confirm the **plan limits** in section 4. They're a starting point and easy to change in `server/src/lib/plans.ts`.
4. The `whatsappcrm.dakyx.com` DNS record, once Railway gives the target.
