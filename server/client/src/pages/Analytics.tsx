import { useState } from "react";
import { api, CATEGORY_LABEL, ghs, type Category } from "../api";
import { PageHeader, useLoad, useMe } from "../ui";

interface Analytics {
  days: number;
  perDay: Array<{ day: string; newChats: number; orders: number; paidGhs: number }>;
  response: { medianMinutes: number | null; p90Minutes: number | null; answeredTurns: number; within1h: number };
  categories: Partial<Record<Category, number>>;
  funnel: { newChats: number; orders: number; confirmed: number; paid: number; conversion: number | null };
  revenue: { confirmedGhs: number; paidThroughLinksGhs: number };
  broadcasts: Array<{ id: string; name: string; sentAt: string; costGhs: number; recipients: number; delivered: number; read: number; failed: number }>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const BAR = "#16a064"; // brand-500, checked against the white surface (contrast ≥ 3:1)

function duration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

export default function AnalyticsPage() {
  const { me } = useMe();
  const [days, setDays] = useState(30);
  const { data, error } = useLoad(() => api<Analytics>(`/analytics?days=${days}`), [days]);
  const canExport = !!me.billing.limits.analyticsExport;

  return (
    <>
      <PageHeader title="Analytics" subtitle="How fast you answer, how many chats turn into orders, and what your broadcasts did." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
          {[7, 30, 90].map((d) => (
            <button key={d} className={`rounded-md px-3 py-1 ${days === d ? "bg-white shadow-sm" : "text-slate-600"}`} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
        {canExport ? (
          <a className="btn-ghost" href={`/api/analytics/export.csv?days=${days}`}>Export CSV</a>
        ) : (
          <span className="text-xs text-slate-500">CSV export is on Pro</span>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Typical wait for your reply" value={duration(data.response.medianMinutes)} note={data.response.p90Minutes !== null ? `1 in 10 wait over ${duration(data.response.p90Minutes)}` : "No replies yet"} />
            <Tile
              label="Answered within an hour"
              value={data.response.answeredTurns ? `${Math.round((data.response.within1h / data.response.answeredTurns) * 100)}%` : "—"}
              note={`${plural(data.response.answeredTurns, "customer message")} answered`}
            />
            <Tile label="Chats that became orders" value={data.funnel.conversion === null ? "—" : `${Math.round(data.funnel.conversion * 100)}%`} note={`${plural(data.funnel.orders, "order")} from ${plural(data.funnel.newChats, "new chat")}`} />
            <Tile label="Confirmed sales" value={ghs(data.revenue.confirmedGhs)} note={data.revenue.paidThroughLinksGhs ? `${ghs(data.revenue.paidThroughLinksGhs)} paid through links` : "Ordered, paid or delivered"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="New business chats per day" rows={data.perDay.map((d) => ({ key: d.day, value: d.newChats }))} unit="chat" />
            <ChartCard title="Orders captured per day" rows={data.perDay.map((d) => ({ key: d.day, value: d.orders }))} unit="order" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <CategoryBars categories={data.categories} />
            <Broadcasts rows={data.broadcasts} />
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-1 text-xs text-slate-500">{note}</div>
    </div>
  );
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Single-series column chart: thin bars with 4px rounded tops on a baseline, recessive grid, hover tooltip, table view. */
function ChartCard({ title, rows, unit }: { title: string; rows: Array<{ key: string; value: number }>; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 600;
  const H = 180;
  const pad = { l: 28, r: 8, t: 12, b: 22 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * Math.ceil(max / step);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const slot = (W - pad.l - pad.r) / rows.length;
  const barW = Math.max(2, Math.min(18, slot - 2)); // ≥2px surface gap between neighbours
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const labelEvery = Math.ceil(rows.length / 6);
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button className="text-xs text-brand-700 hover:underline" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show as table"}</button>
      </div>
      <p className="text-xs text-slate-500">{plural(total, unit)} in total</p>
      {table ? (
        <div className="mt-3 max-h-48 overflow-y-auto text-sm">
          <table className="w-full">
            <tbody>
              {rows.slice().reverse().map((r) => (
                <tr key={r.key} className="border-b border-slate-50"><td className="py-1 text-slate-600">{shortDate(r.key)}</td><td className="py-1 text-right tabular-nums">{r.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title}: ${plural(total, unit)}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={t === 0 ? 1 : 0.5} />
                <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">{t}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const x = pad.l + i * slot + (slot - barW) / 2;
              const h = y(0) - y(r.value);
              const rad = Math.min(4, barW / 2, h);
              return (
                <g key={r.key} onMouseEnter={() => setHover(i)}>
                  {/* Hit target is the whole column, wider and taller than the bar. */}
                  <rect x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
                  {r.value > 0 && (
                    <path
                      d={`M${x},${y(0)} V${y(r.value) + rad} Q${x},${y(r.value)} ${x + rad},${y(r.value)} H${x + barW - rad} Q${x + barW},${y(r.value)} ${x + barW},${y(r.value) + rad} V${y(0)} Z`}
                      fill={BAR}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  {i % labelEvery === 0 && <text x={pad.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">{shortDate(r.key)}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && rows[hover] && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow"
              style={{ left: `${((pad.l + hover * slot + slot / 2) / W) * 100}%`, top: 0 }}
            >
              {shortDate(rows[hover].key)}: <b>{rows[hover].value}</b> {rows[hover].value === 1 ? unit : `${unit}s`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryBars({ categories }: { categories: Partial<Record<Category, number>> }) {
  const entries = (Object.keys(CATEGORY_LABEL) as Category[]).map((c) => [c, categories[c] ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold">Active chats by type</h2>
      <ul className="mt-3 space-y-2">
        {entries.map(([c, n]) => (
          <li key={c} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-xs" title={`${CATEGORY_LABEL[c]}: ${n}`}>
            <span className="text-slate-600">{CATEGORY_LABEL[c]}</span>
            <span className="h-2.5 rounded-r bg-slate-100">
              {n > 0 && <span className="block h-2.5 rounded-r" style={{ width: `${(n / max) * 100}%`, background: BAR }} />}
            </span>
            <span className="text-right tabular-nums text-slate-700">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Broadcasts({ rows }: { rows: Analytics["broadcasts"] }) {
  return (
    <div className="card overflow-x-auto p-5">
      <h2 className="text-sm font-semibold">Broadcast results</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No broadcasts sent in this period.</p>
      ) : (
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr><th className="py-1.5">Broadcast</th><th className="text-right">Sent</th><th className="text-right">Delivered</th><th className="text-right">Read</th><th className="text-right">Cost</th></tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-slate-50">
                <td className="py-1.5">{b.name}</td>
                <td className="text-right tabular-nums">{b.recipients}</td>
                <td className="text-right tabular-nums">{b.recipients ? `${Math.round((b.delivered / b.recipients) * 100)}%` : "—"}</td>
                <td className="text-right tabular-nums">{b.recipients ? `${Math.round((b.read / b.recipients) * 100)}%` : "—"}</td>
                <td className="text-right tabular-nums">{ghs(b.costGhs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
