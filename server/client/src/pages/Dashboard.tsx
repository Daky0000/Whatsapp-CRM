import { Link } from "react-router-dom";
import { api, CATEGORY_LABEL, ghs, type Category } from "../api";
import { Meter, PageHeader, useAction, useLoad, useMe, useToast } from "../ui";

interface Dashboard {
  byCategory: Partial<Record<Category, number>>;
  pendingDrafts: number;
  waiting: number;
  newLeads7d: number;
  orders: Array<{ stage: string; count: number; totalGhs: number }>;
  messages7d: { inbound: number; outbound: number };
}

interface Summary {
  date: string;
  newChats: number;
  newOrders: number;
  paidGhs: number;
  repliesWaiting: number;
  unanswered: Array<{ conversationId: string; name: string; waitingHours: number }>;
  openComplaints: number;
}

export default function DashboardPage() {
  const { me } = useMe();
  const { data, reload } = useLoad(() => api<Dashboard>("/dashboard"));
  const summary = useLoad(() => api<Summary>("/summary"));
  const { busy, run } = useAction();
  const toast = useToast();

  const scan = async () => {
    const r = await run(() => api<{ considered: number; triaged: number; drafted: number; quota: number; ai_off: number }>("/conversations/scan", { body: {} }));
    if (!r) return;
    if (r.ai_off) toast("AI isn't switched on for this server yet.", "error");
    else if (r.quota) toast(`Sorted ${r.triaged + r.drafted} chats. You've reached this month's AI limit.`, "error");
    else toast(r.considered ? `Sorted ${r.triaged + r.drafted} chats and drafted ${r.drafted} replies.` : "Everything is already sorted.");
    void reload();
  };

  const openOrders = data?.orders.filter((o) => !["DELIVERED", "LOST"].includes(o.stage)) ?? [];
  const openValue = openOrders.reduce((s, o) => s + o.totalGhs, 0);
  const lim = me.billing.limits;

  return (
    <>
      <PageHeader
        title={`Hello, ${me.user.name.split(" ")[0]}`}
        subtitle="Here's what's happening on your WhatsApp."
        actions={
          <button className="btn-primary" onClick={scan} disabled={busy || !me.connection}>
            {busy ? "Scanning…" : "✨ Scan & sort my chats"}
          </button>
        }
      />
      {summary.data && <MorningSummary s={summary.data} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Replies waiting for approval" value={data?.pendingDrafts} to="/inbox?pending=1" highlight />
        <Stat label="Chats with unread messages" value={data?.waiting} to="/inbox" />
        <Stat label="New leads (7 days)" value={data?.newLeads7d} to="/inbox?category=NEW_LEAD" />
        <Stat label="Open orders" value={openOrders.reduce((s, o) => s + o.count, 0)} sub={openValue ? ghs(openValue) : undefined} to="/orders" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">Your chats by type</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <Link key={c} to={`/inbox?category=${c}`} className="rounded-lg border border-slate-100 p-3 hover:border-brand-100 hover:bg-brand-50">
                <div className="text-2xl font-semibold tabular-nums">{data?.byCategory[c] ?? 0}</div>
                <div className="text-xs text-slate-500">{CATEGORY_LABEL[c]}</div>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Last 7 days: {data?.messages7d.inbound ?? 0} messages in, {data?.messages7d.outbound ?? 0} out.
          </p>
        </div>
        <div className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">This month's AI allowance</h2>
          <Meter label="Chats sorted" used={me.billing.usage.triage} limit={lim.aiTriagePerMonth as number | null} />
          <Meter label="Replies drafted" used={me.billing.usage.drafts} limit={lim.aiDraftsPerMonth as number | null} />
          <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
            Message wallet: <span className="font-medium text-slate-700">{ghs(me.workspace.walletGhs)}</span> ·{" "}
            <Link to="/billing" className="text-brand-700 hover:underline">Top up</Link>
          </div>
        </div>
      </div>
    </>
  );
}

function MorningSummary({ s }: { s: Summary }) {
  const yesterday = new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="card mb-4 border-brand-100 bg-brand-50/50 p-4 text-sm">
      <p>
        <span className="font-semibold">Yesterday ({yesterday}):</span> {s.newChats} new customer chat{s.newChats === 1 ? "" : "s"}, {s.newOrders} order{s.newOrders === 1 ? "" : "s"} captured
        {s.paidGhs > 0 && <>, {ghs(s.paidGhs)} paid through links</>}.
      </p>
      {s.unanswered.length > 0 && (
        <p className="mt-2">
          <span className="font-semibold text-amber-800">Waiting for you:</span>{" "}
          {s.unanswered.map((u, i) => (
            <span key={u.conversationId}>
              {i > 0 && ", "}
              <Link to={`/inbox/${u.conversationId}`} className="text-brand-700 hover:underline">{u.name}</Link>
              <span className="text-slate-500"> ({u.waitingHours}h)</span>
            </span>
          ))}
        </p>
      )}
      {s.openComplaints > 0 && (
        <p className="mt-1">
          <Link to="/inbox?category=COMPLAINT" className="text-red-700 hover:underline">{s.openComplaints} open complaint{s.openComplaints === 1 ? "" : "s"}</Link>
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub, to, highlight }: { label: string; value?: number; sub?: string; to: string; highlight?: boolean }) {
  return (
    <Link to={to} className={`card block p-4 hover:shadow-sm ${highlight && value ? "border-brand-500 ring-1 ring-brand-100" : ""}`}>
      <div className="text-2xl font-semibold tabular-nums">{value ?? "—"}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
      {sub && <div className="mt-1 text-xs font-medium text-brand-700">{sub}</div>}
    </Link>
  );
}
