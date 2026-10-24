import { Link } from "react-router-dom";
import { api, displayPhone, ghs, STAGES, type Stage } from "../api";
import { Empty, PageHeader, useAction, useLoad, useMe } from "../ui";

interface Order {
  id: string;
  conversationId: string;
  items: Array<{ name: string; quantity: number; variant: string | null; unitPriceGhs: number | null }>;
  deliveryLocation: string | null;
  totalGhs: string | null;
  stage: Stage;
  paymentUrl: string | null;
  paidAt: string | null;
  updatedAt: string;
  contact: { name: string | null; phone: string };
}

const STAGE_LABEL: Record<Stage, string> = { NEW: "New", NEGOTIATING: "Negotiating", ORDERED: "Ordered", PAID: "Paid", DELIVERED: "Delivered", LOST: "Lost" };

export default function OrdersPage() {
  const { me } = useMe();
  const orders = useLoad(() => api<Order[]>("/orders"));
  const { run } = useAction();
  const canEdit = !!me.billing.limits.orderPipeline;

  const move = (o: Order, stage: Stage) => run(() => api(`/orders/${o.id}`, { method: "PATCH", body: { stage } })).then(orders.reload);

  return (
    <>
      <PageHeader title="Orders" subtitle="The AI picks orders out of your chats: items, quantities and delivery location." />
      {!canEdit && <p className="mb-3 text-sm text-slate-500">Starter shows captured orders. Upgrade to Pro to move them through the pipeline.</p>}
      {orders.data?.length === 0 ? (
        <Empty title="No orders captured yet">When a customer asks to buy something specific, it shows up here.</Empty>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const col = orders.data?.filter((o) => o.stage === stage) ?? [];
            const total = col.reduce((s, o) => s + Number(o.totalGhs ?? 0), 0);
            return (
              <div key={stage} className="w-72 shrink-0 rounded-xl bg-slate-100 p-2">
                <div className="flex items-baseline justify-between px-2 py-1.5 text-xs font-semibold text-slate-600">
                  <span>{STAGE_LABEL[stage]} · {col.length}</span>
                  {total > 0 && <span className="font-normal">{ghs(total)}</span>}
                </div>
                <div className="space-y-2">
                  {col.map((o) => (
                    <div key={o.id} className="card p-3 text-sm">
                      <Link to={`/inbox/${o.conversationId}`} className="font-medium hover:underline">
                        {o.contact.name ?? displayPhone(o.contact.phone)}
                      </Link>
                      <ul className="mt-1 text-xs text-slate-600">
                        {o.items.map((i, n) => (
                          <li key={n}>{i.quantity}× {i.name}{i.variant ? ` (${i.variant})` : ""}{i.unitPriceGhs ? ` @ ${ghs(i.unitPriceGhs)}` : ""}</li>
                        ))}
                      </ul>
                      {o.deliveryLocation && <p className="mt-1 text-xs text-slate-500">📍 {o.deliveryLocation}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs font-semibold">
                          {ghs(o.totalGhs)}
                          {o.paidAt ? <span className="ml-1.5 text-emerald-700">✓ paid</span> : o.paymentUrl ? <span className="ml-1.5 font-normal text-amber-700">link sent</span> : null}
                        </span>
                        {canEdit && (
                          <select className="rounded border border-slate-200 px-1 py-0.5 text-xs" value={o.stage} onChange={(e) => move(o, e.target.value as Stage)}>
                            {STAGES.map((s) => (
                              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
