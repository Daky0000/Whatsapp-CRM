import { useState } from "react";
import { api, displayPhone, ghs } from "../api";
import { Modal, PageHeader, useAction, useLoad } from "../ui";

interface Row {
  id: string;
  name: string;
  owner: { name: string; email: string; phone: string | null } | null;
  staff: boolean;
  plan: "STARTER" | "PRO";
  status: string;
  active: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  connection: { mode: string; displayPhone: string | null } | null;
  conversations: number;
  contacts: number;
  aiSortedThisMonth: number;
  paidGhs: number;
  walletGhs: number;
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function AdminPage() {
  const [q, setQ] = useState("");
  const rows = useLoad(() => api<Row[]>(`/admin/workspaces?q=${encodeURIComponent(q)}`), [q]);
  const [extending, setExtending] = useState<Row | null>(null);
  const all = rows.data ?? [];
  const paying = all.filter((r) => r.status === "ACTIVE" && !r.staff);

  return (
    <>
      <PageHeader title="All workspaces" subtitle="DakyXTech staff only. Every seller on WhatsApp CRM." />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Workspaces" value={all.length} />
        <Stat label="On trial" value={all.filter((r) => r.status === "TRIALING" && r.active).length} />
        <Stat label="Paying" value={paying.length} />
        <Stat label="Monthly revenue (active plans)" value={ghs(paying.reduce((s, r) => s + (r.plan === "PRO" ? 150 : 50), 0))} />
      </div>
      <input className="input mb-3 max-w-sm" placeholder="Search business, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
            <tr>
              <th className="p-3">Business</th>
              <th className="p-3">Owner</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Until</th>
              <th className="p-3">WhatsApp</th>
              <th className="p-3 text-right">Chats</th>
              <th className="p-3 text-right">Paid</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 align-top">
                <td className="p-3">
                  <div className="font-medium">{r.name}{r.staff && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">staff</span>}</div>
                  <div className="text-xs text-slate-500">since {date(r.createdAt)}</div>
                </td>
                <td className="p-3 text-xs">
                  <div>{r.owner?.name}</div>
                  <div className="text-slate-500">{r.owner?.email}</div>
                  {r.owner?.phone && <div className="text-slate-500">{displayPhone(r.owner.phone)}</div>}
                </td>
                <td className="p-3 text-xs">
                  <div className="font-medium">{r.status === "TRIALING" ? "Trial" : r.plan === "PRO" ? "Pro" : "Starter"}</div>
                  <div className={r.active ? "text-brand-700" : "text-red-600"}>{r.active ? r.status.toLowerCase().replace("_", " ") : "ended"}</div>
                </td>
                <td className="p-3 text-xs whitespace-nowrap">{date(r.status === "TRIALING" ? r.trialEndsAt : r.currentPeriodEnd)}</td>
                <td className="p-3 text-xs">{r.connection ? `${r.connection.mode === "CLOUD" ? "Live" : "Import"}${r.connection.displayPhone ? ` · ${r.connection.displayPhone}` : ""}` : <span className="text-slate-400">not connected</span>}</td>
                <td className="p-3 text-right text-xs tabular-nums">{r.conversations}<div className="text-slate-500">{r.aiSortedThisMonth} sorted</div></td>
                <td className="p-3 text-right text-xs tabular-nums">{ghs(r.paidGhs)}</td>
                <td className="p-3 text-right">
                  {!r.staff && <button className="text-xs text-brand-700 hover:underline" onClick={() => setExtending(r)}>Extend</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {extending && <ExtendModal row={extending} onClose={() => setExtending(null)} onDone={rows.reload} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function ExtendModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<"STARTER" | "PRO">(row.plan);
  const [days, setDays] = useState(30);
  const { busy, run } = useAction();
  const submit = async () => {
    if (await run(() => api(`/admin/workspaces/${row.id}/extend`, { body: { plan, days } }), `${row.name} extended by ${days} days`)) (onDone(), onClose());
  };
  return (
    <Modal title={`Extend ${row.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">Gives access without a payment. Use it for goodwill, or a renewal sorted out by phone. Nothing is charged.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Plan</label>
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value as "STARTER" | "PRO")}>
            <option value="STARTER">Starter</option>
            <option value="PRO">Pro</option>
          </select>
        </div>
        <div>
          <label className="label">Days</label>
          <input className="input" type="number" min={1} max={366} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
      </div>
      <button className="btn-primary mt-4 w-full" disabled={busy} onClick={submit}>Extend</button>
    </Modal>
  );
}
