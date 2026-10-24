import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ghs } from "../api";
import { Meter, PageHeader, useAction, useLoad, useMe, useToast } from "../ui";

type Limits = Record<string, number | boolean | string | null>;
interface Billing {
  plans: Array<Limits & { id: "STARTER" | "PRO"; name: string; priceGhs: number; annualPriceGhs: number }>;
  current: { plan: string; status: string; active: boolean; trialEndsAt: string | null; currentPeriodEnd: string | null; autoRenew: boolean; limits: Limits };
  usage: Record<string, number>;
  wallet: { balanceGhs: number; entries: Array<{ id: string; amountGhs: number; description: string; createdAt: string }> };
  payments: Array<{ id: string; kind: string; plan: string | null; months: number | null; amountGhs: number; status: string; channel: string | null; createdAt: string }>;
  paystackReady: boolean;
}

const FEATURES: Array<[string, string, (v: Limits[string]) => string]> = [
  ["historyDays", "Chat history on connect", (v) => (Number(v) >= 180 ? "6 months" : `${v} days`)],
  ["aiTriagePerMonth", "Chats sorted by AI / month", (v) => (v === null ? "Unlimited" : Number(v).toLocaleString())],
  ["aiDraftsPerMonth", "AI reply drafts / month", (v) => (v === null ? "Unlimited" : Number(v).toLocaleString())],
  ["contacts", "Contacts", (v) => (v === null ? "Unlimited" : Number(v).toLocaleString())],
  ["seats", "Team seats", (v) => String(v)],
  ["lists", "Broadcast lists", (v) => (v === null ? "Unlimited" : String(v))],
  ["broadcastRecipientsPerMonth", "Broadcast recipients / month", (v) => Number(v).toLocaleString()],
  ["freeBroadcastCredits", "Free broadcast messages / month", (v) => String(v)],
  ["autoReplyRules", "Auto-reply rules", (v) => (v === null ? "Unlimited" : String(v))],
  ["products", "Products the AI knows", (v) => (v === null ? "Unlimited" : String(v))],
  ["scheduledBroadcasts", "Scheduled broadcasts", (v) => (v ? "✓" : "—")],
  ["followUps", "AI follow-up reminders", (v) => (v ? "✓" : "—")],
  ["orderPipeline", "Order pipeline", (v) => (v ? "✓" : "View only")],
];

export default function BillingPage() {
  const { me, reload: reloadMe } = useMe();
  const billing = useLoad(() => api<Billing>("/billing"));
  const [params, setParams] = useSearchParams();
  const [annual, setAnnual] = useState(false);
  const [autoRenew, setAutoRenew] = useState(false);
  const [topUp, setTopUp] = useState("50");
  const { busy, run } = useAction();
  const toast = useToast();
  const verified = useRef(false);

  // Back from Paystack: ?reference=… — confirm with the server, which asks Paystack.
  useEffect(() => {
    const reference = params.get("reference");
    if (!reference || verified.current) return;
    verified.current = true;
    void (async () => {
      const r = await run(() => api<{ outcome: string }>("/billing/verify", { body: { reference } }));
      if (r?.outcome === "applied" || r?.outcome === "already") toast("Payment received. Thank you! 🎉");
      else if (r?.outcome === "unpaid") toast("The payment didn't go through. You haven't been charged.", "error");
      setParams({});
      void billing.reload();
      void reloadMe();
    })();
  }, [params, run, toast, setParams, billing, reloadMe]);

  const checkout = async (plan: "STARTER" | "PRO") => {
    const r = await run(() => api<{ url: string }>("/billing/checkout", { body: { plan, months: annual ? 12 : 1, autoRenew } }));
    if (r) window.location.href = r.url;
  };
  const doTopUp = async () => {
    const r = await run(() => api<{ url: string }>("/billing/topup", { body: { amountGhs: Number(topUp) } }));
    if (r) window.location.href = r.url;
  };

  const b = billing.data;
  if (!b) return <p className="text-sm text-slate-400">{billing.error ?? "Loading…"}</p>;
  const until = b.current.status === "TRIALING" ? b.current.trialEndsAt : b.current.currentPeriodEnd;

  return (
    <>
      <PageHeader title="Billing" subtitle="Pay with Mobile Money or card through Paystack." />
      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <div className="text-sm font-semibold">
            {b.current.status === "TRIALING" ? "Free trial (Pro features)" : `${b.current.plan === "PRO" ? "Pro" : "Starter"} plan`}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${b.current.active ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>
              {b.current.active ? (b.current.status === "PAST_DUE" ? "payment due" : "active") : "ended"}
            </span>
          </div>
          {until && <div className="mt-1 text-xs text-slate-500">{b.current.active ? (b.current.autoRenew ? "Renews" : "Runs until") : "Ended"} {new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>}
        </div>
        {b.current.autoRenew && me.user.role === "OWNER" && (
          <button className="btn-ghost" onClick={() => confirm("Stop automatic renewal? You keep access until the end of this period.") && run(() => api("/billing/cancel", { body: {} }), "Auto-renew turned off").then(billing.reload)}>
            Turn off auto-renew
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          <button className={`rounded-md px-3 py-1 ${!annual ? "bg-white shadow-sm" : ""}`} onClick={() => setAnnual(false)}>Monthly</button>
          <button className={`rounded-md px-3 py-1 ${annual ? "bg-white shadow-sm" : ""}`} onClick={() => setAnnual(true)}>Yearly · 2 months free</button>
        </div>
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
          Renew automatically (card only)
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {b.plans.map((p) => {
          const current = b.current.plan === p.id && b.current.status === "ACTIVE";
          return (
            <div key={p.id} className={`card p-5 ${p.id === "PRO" ? "border-brand-500 ring-1 ring-brand-100" : ""}`}>
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                {p.id === "PRO" && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] text-white">Everything</span>}
              </div>
              <div className="mt-2 text-3xl font-semibold">
                {ghs(annual ? p.annualPriceGhs : p.priceGhs).replace(".00", "")}
                <span className="text-sm font-normal text-slate-500">/{annual ? "year" : "month"}</span>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {FEATURES.map(([key, label, fmt]) => (
                  <li key={key} className="flex justify-between gap-3 border-b border-slate-50 pb-1.5">
                    <span className="text-slate-600">{label}</span>
                    <span className="font-medium">{fmt(p[key])}</span>
                  </li>
                ))}
              </ul>
              {me.user.role === "OWNER" && (
                <button className={`${p.id === "PRO" ? "btn-primary" : "btn-ghost"} mt-5 w-full`} disabled={busy || !b.paystackReady} onClick={() => checkout(p.id)}>
                  {current ? "Renew / pay ahead" : `Choose ${p.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!b.paystackReady && <p className="mt-2 text-xs text-amber-700">Payments are not configured on this server yet.</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">This month</h2>
          <Meter label="Chats sorted by AI" used={b.usage.ai_triage ?? 0} limit={b.current.limits.aiTriagePerMonth as number | null} />
          <Meter label="AI reply drafts" used={b.usage.ai_draft ?? 0} limit={b.current.limits.aiDraftsPerMonth as number | null} />
          <Meter label="Broadcast recipients" used={b.usage.broadcast_recipients ?? 0} limit={b.current.limits.broadcastRecipientsPerMonth as number | null} />
          <Meter label="Free broadcast messages" used={b.usage.free_broadcast ?? 0} limit={b.current.limits.freeBroadcastCredits as number | null} />
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold">Message wallet: {ghs(b.wallet.balanceGhs)}</h2>
          <p className="mt-1 text-xs text-slate-500">
            WhatsApp charges for every broadcast (marketing) message. Your wallet pays that fee after your free messages are used up. Replies to customers who messaged you in the last 24 hours are free.
          </p>
          <div className="mt-3 flex gap-2">
            <select className="input w-auto" value={topUp} onChange={(e) => setTopUp(e.target.value)}>
              {["20", "50", "100", "200", "500"].map((v) => (
                <option key={v} value={v}>GHS {v}</option>
              ))}
            </select>
            <button className="btn-primary" onClick={doTopUp} disabled={busy || !b.paystackReady}>Top up</button>
          </div>
          <ul className="mt-3 max-h-48 divide-y divide-slate-100 overflow-y-auto text-xs">
            {b.wallet.entries.map((e) => (
              <li key={e.id} className="flex justify-between py-1.5">
                <span className="text-slate-600">{e.description}</span>
                <span className={e.amountGhs > 0 ? "text-brand-700" : ""}>{e.amountGhs > 0 ? "+" : ""}{ghs(e.amountGhs)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {b.payments.length > 0 && (
        <div className="card mt-4 overflow-x-auto p-5">
          <h2 className="text-sm font-semibold">Payments</h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {b.payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="py-2">{p.kind === "WALLET" ? "Wallet top-up" : `${p.plan === "PRO" ? "Pro" : "Starter"} · ${p.months === 12 ? "1 year" : "1 month"}`}</td>
                  <td className="py-2">{ghs(p.amountGhs)}</td>
                  <td className="py-2 text-xs text-slate-500">{p.status.toLowerCase()}{p.channel ? ` · ${p.channel.replace("_", " ")}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
