import { useState } from "react";
import { api, ghs } from "../api";
import { Empty, Modal, PageHeader, useAction, useLoad, useMe } from "../ui";

interface List {
  id: string;
  name: string;
  members: number;
}
interface Broadcast {
  id: string;
  name: string;
  templateName: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  costGhs: number;
  list: { name: string } | null;
  stats: Record<string, number>;
}
interface Template {
  name: string;
  language: string;
  category: string;
  body: string;
  variableCount: number;
}
interface Quote {
  recipients: number;
  free: number;
  paid: number;
  costGhs: number;
  remainingThisMonth: number;
  notOptedIn: number;
}

export default function BroadcastsPage() {
  const { me } = useMe();
  const lists = useLoad(() => api<List[]>("/lists"));
  const broadcasts = useLoad(() => api<Broadcast[]>("/broadcasts"));
  const [creating, setCreating] = useState(false);
  const [newList, setNewList] = useState("");
  const [confirming, setConfirming] = useState<{ b: Broadcast; q: Quote } | null>(null);
  const { busy, run } = useAction();

  const addList = async () => {
    const ok = await run(() => api("/lists", { body: { name: newList } }), "List created");
    if (ok) (setNewList(""), void lists.reload());
  };

  const prepareSend = async (b: Broadcast) => {
    const q = await run(() => api<Quote>(`/broadcasts/${b.id}/quote`));
    if (q) setConfirming({ b, q });
  };

  const send = async () => {
    if (!confirming) return;
    const ok = await run(() => api(`/broadcasts/${confirming.b.id}/send`, { body: {} }), "Broadcast sent");
    setConfirming(null);
    if (ok) void broadcasts.reload();
  };

  return (
    <>
      <PageHeader
        title="Broadcasts"
        subtitle="Send an approved WhatsApp template to a list of customers."
        actions={<button className="btn-primary" onClick={() => setCreating(true)} disabled={!lists.data?.length}>New broadcast</button>}
      />
      {me.connection?.mode !== "CLOUD" && (
        <div className="card mb-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Broadcasts need your number connected through the WhatsApp Cloud API (Settings → WhatsApp). WhatsApp only allows broadcasts with templates it has approved.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Broadcast lists</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {lists.data?.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <span>{l.name}</span>
                <span className="flex items-center gap-3 text-xs text-slate-500">
                  {l.members} contacts
                  <button className="text-red-600 hover:underline" onClick={() => confirm(`Delete list “${l.name}”?`) && run(() => api(`/lists/${l.id}`, { method: "DELETE" })).then(lists.reload)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input className="input" placeholder="New list name" value={newList} onChange={(e) => setNewList(e.target.value)} />
            <button className="btn-ghost" onClick={addList} disabled={!newList.trim() || busy}>Add</button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Add people to lists from the Contacts page. Contacts who reply STOP are skipped automatically.</p>
        </div>
        <div className="lg:col-span-2">
          {!broadcasts.data?.length ? (
            <Empty title="No broadcasts yet">Create a list, add contacts, then send a promotion or update in one go.</Empty>
          ) : (
            <div className="space-y-2">
              {broadcasts.data.map((b) => (
                <div key={b.id} className="card flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-slate-500">
                      {b.templateName} → {b.list?.name ?? "deleted list"} ·{" "}
                      {b.status === "SCHEDULED" && b.scheduledAt ? `scheduled ${new Date(b.scheduledAt).toLocaleString()}` : b.status.toLowerCase()}
                      {b.sentAt && ` · ${new Date(b.sentAt).toLocaleString()}`}
                    </div>
                    {Object.keys(b.stats).length > 0 && (
                      <div className="mt-1 text-xs text-slate-600">
                        {Object.entries(b.stats).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ")} · cost {ghs(b.costGhs)}
                      </div>
                    )}
                  </div>
                  {["DRAFT", "SCHEDULED"].includes(b.status) && (
                    <>
                      <button className="btn-primary" onClick={() => prepareSend(b)} disabled={busy}>Send now</button>
                      <button className="btn-ghost" onClick={() => run(() => api(`/broadcasts/${b.id}/cancel`, { body: {} })).then(broadcasts.reload)}>Cancel</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {creating && <NewBroadcast lists={lists.data ?? []} onClose={() => setCreating(false)} onCreated={broadcasts.reload} canSchedule={!!me.billing.limits.scheduledBroadcasts} />}
      {confirming && (
        <Modal title="Send this broadcast?" onClose={() => setConfirming(null)}>
          <div className="space-y-2 text-sm">
            <p>It goes to <b>{confirming.q.recipients}</b> contacts on “{confirming.b.list?.name}”.</p>
            <p>{confirming.q.free} use your free credits. {confirming.q.paid} are paid from your wallet: <b>{ghs(confirming.q.costGhs)}</b>.</p>
            {confirming.q.notOptedIn > 0 && (
              <p className="rounded bg-amber-50 p-2 text-amber-900">
                {confirming.q.notOptedIn} of them haven't said yes to broadcasts. Messaging people who didn't agree gets your number reported, and WhatsApp can then limit it.
              </p>
            )}
            <p className="text-xs text-slate-500">Failed messages are refunded to your wallet.</p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setConfirming(null)}>Not yet</button>
            <button className="btn-primary" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function NewBroadcast({ lists, onClose, onCreated, canSchedule }: { lists: List[]; onClose: () => void; onCreated: () => void; canSchedule: boolean }) {
  const templates = useLoad(() => api<{ templates: Template[]; connected: boolean }>("/whatsapp/templates"));
  const [form, setForm] = useState({ name: "", listId: lists[0]?.id ?? "", template: "", variables: [] as string[], scheduledAt: "" });
  const { busy, run } = useAction();
  const tpl = templates.data?.templates.find((t) => `${t.name}|${t.language}` === form.template);

  const submit = async () => {
    if (!tpl) return;
    const ok = await run(
      () =>
        api("/broadcasts", {
          body: {
            name: form.name,
            listId: form.listId,
            templateName: tpl.name,
            templateLang: tpl.language,
            variables: form.variables.slice(0, tpl.variableCount),
            scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
          },
        }),
      form.scheduledAt ? "Broadcast scheduled" : "Broadcast saved. Press Send when ready.",
    );
    if (ok) (onCreated(), onClose());
  };

  return (
    <Modal title="New broadcast" onClose={onClose} wide>
      <div className="space-y-3">
        <div>
          <label className="label">Name (for you)</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Christmas sale" />
        </div>
        <div>
          <label className="label">Send to</label>
          <select className="input" value={form.listId} onChange={(e) => setForm({ ...form, listId: e.target.value })}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name} ({l.members})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Approved template</label>
          {templates.loading ? (
            <p className="text-sm text-slate-400">Loading templates from WhatsApp…</p>
          ) : templates.error ? (
            <p className="text-sm text-red-600">{templates.error}</p>
          ) : !templates.data?.templates.length ? (
            <p className="text-sm text-slate-600">
              No approved templates yet. Create one in{" "}
              <a className="text-brand-700 underline" href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noreferrer">WhatsApp Manager</a>. Approval usually takes minutes, sometimes a day.
            </p>
          ) : (
            <select className="input" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value, variables: [] })}>
              <option value="">Choose…</option>
              {templates.data.templates.map((t) => (
                <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}, {t.category.toLowerCase()})</option>
              ))}
            </select>
          )}
        </div>
        {tpl && (
          <div className="rounded-lg bg-[#efeae2] p-3">
            <div className="rounded-lg bg-white p-3 text-sm whitespace-pre-wrap shadow-sm">{tpl.body}</div>
            {Array.from({ length: tpl.variableCount }).map((_, i) => (
              <div key={i} className="mt-2">
                <label className="label">{`{{${i + 1}}}`} — type <code>{"{{name}}"}</code> for each customer's first name</label>
                <input
                  className="input"
                  value={form.variables[i] ?? ""}
                  onChange={(e) => {
                    const v = [...form.variables];
                    v[i] = e.target.value;
                    setForm({ ...form, variables: v });
                  }}
                />
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="label">Schedule for later {canSchedule ? "(optional)" : "(Pro plan)"}</label>
          <input className="input" type="datetime-local" disabled={!canSchedule} value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
        </div>
        <button className="btn-primary w-full" disabled={busy || !tpl || !form.name || !form.listId} onClick={submit}>
          {form.scheduledAt ? "Schedule" : "Save broadcast"}
        </button>
      </div>
    </Modal>
  );
}
