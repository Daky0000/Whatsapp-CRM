import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, CATEGORY_LABEL, displayPhone, ghs, STAGES, timeAgo, type Category, type Stage } from "../api";
import { CategoryBadge, Modal, useAction, useLoad, useMe, useToast } from "../ui";

interface ListItem {
  id: string;
  contact: { id: string; name: string | null; phone: string; labels: string[] };
  category: Category;
  stage: Stage;
  summary: string | null;
  urgency: number | null;
  unread: number;
  lastMessageAt: string | null;
  lastMessage: { body: string | null; type: string; direction: "INBOUND" | "OUTBOUND" } | null;
  pendingDrafts: number;
}

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  mediaId: string | null;
  status: string;
  error: string | null;
  origin: string;
  autoRuleId: string | null;
  timestamp: string;
}

interface Draft {
  id: string;
  body: string;
  kind: "REPLY" | "FOLLOW_UP";
  status: "PENDING" | "READY_TO_HAND_SEND";
}

interface Thread {
  id: string;
  category: Category;
  stage: Stage;
  aiSummary: string | null;
  urgency: number | null;
  contact: { id: string; name: string | null; phone: string; optedOut: boolean };
  messages: Message[];
  drafts: Draft[];
  order: { items: Array<{ name: string; quantity: number; variant: string | null; unitPriceGhs: number | null }>; deliveryLocation: string | null; totalGhs: string | null } | null;
  windowOpen: boolean;
  sendRoute: "api" | "link";
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "All business" },
  { key: "pending", label: "Needs approval" },
  ...(["NEW_LEAD", "ORDER", "INQUIRY", "COMPLAINT", "FOLLOW_UP", "UNSORTED", "NOT_BUSINESS"] as Category[]).map((c) => ({ key: c, label: CATEGORY_LABEL[c] })),
];

export default function InboxPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const filter = params.get("pending") === "1" ? "pending" : (params.get("category") ?? "");
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const query = new URLSearchParams();
  if (filter === "pending") query.set("pending", "1");
  else if (filter) query.set("category", filter);
  if (q) query.set("q", q);
  const list = useLoad(() => api<{ items: ListItem[]; counts: Partial<Record<Category, number>> }>(`/conversations?${query}`), [filter, q]);

  // New WhatsApp messages arrive by webhook; refresh the list every 20 seconds.
  useEffect(() => {
    const t = setInterval(() => void list.reload(), 20_000);
    return () => clearInterval(t);
  }, [list.reload]);

  const setFilter = (key: string) => setParams(key === "pending" ? { pending: "1" } : key ? { category: key } : {});

  return (
    <div className="flex h-full">
      <section className={`flex w-full flex-col border-r border-slate-200 bg-white md:w-96 ${id ? "hidden md:flex" : "flex"}`}>
        <div className="space-y-3 border-b border-slate-100 p-3">
          <div className="flex gap-2">
            <input className="input" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn-ghost shrink-0" onClick={() => setImporting(true)} title="Import a chat export">
              ⬆ Import
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs ${filter === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {f.label}
                {f.key && f.key !== "pending" && list.data?.counts[f.key as Category] ? ` ${list.data.counts[f.key as Category]}` : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.error && <p className="p-4 text-sm text-red-600">{list.error}</p>}
          {list.data?.items.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No chats here yet.</p>}
          {list.data?.items.map((c) => (
            <Link key={c.id} to={`/inbox/${c.id}${params.toString() ? `?${params}` : ""}`} className={`block border-b border-slate-50 px-4 py-3 hover:bg-slate-50 ${c.id === id ? "bg-brand-50" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{c.contact.name ?? displayPhone(c.contact.phone)}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(c.lastMessageAt)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {c.lastMessage?.direction === "OUTBOUND" && "You: "}
                {c.lastMessage?.body ?? (c.lastMessage ? `[${c.lastMessage.type}]` : "")}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <CategoryBadge category={c.category} />
                {c.pendingDrafts > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white">Reply ready</span>}
                {(c.urgency ?? 0) >= 4 && <span className="text-[11px] font-medium text-red-600">Urgent</span>}
                {c.unread > 0 && <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] text-white">{c.unread}</span>}
              </div>
            </Link>
          ))}
        </div>
      </section>
      <section className={`min-w-0 flex-1 ${id ? "flex" : "hidden md:flex"}`}>
        {id ? (
          <ThreadView id={id} onChanged={list.reload} />
        ) : (
          <div className="m-auto max-w-sm p-6 text-center text-sm text-slate-500">Pick a chat to see the conversation and the AI's suggested reply.</div>
        )}
      </section>
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => void list.reload()} />}
    </div>
  );
}

function ThreadView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useMe();
  const { data: t, error, reload } = useLoad(() => api<Thread>(`/conversations/${id}`), [id]);
  const { busy, run } = useAction();
  const [composer, setComposer] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [t?.messages.length]);
  useEffect(() => {
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!t) return <p className="p-6 text-sm text-slate-400">Loading…</p>;

  const refresh = () => (void reload(), onChanged());

  const handleSend = (result: { route: "api" } | { route: "link"; url: string } | undefined) => {
    if (!result) return false;
    if (result.route === "link") {
      window.open(result.url, "_blank", "noopener");
      toast("WhatsApp opened with the message typed in. Press send there.");
    } else toast("Sent ✓");
    refresh();
    return true;
  };

  const approve = async (d: Draft) => {
    const body = editing[d.id] ?? d.body;
    const r = await run(() => api<{ route: "api" } | { route: "link"; url: string }>(`/drafts/${d.id}/approve`, { body: { body } }));
    if (handleSend(r)) setEditing(({ [d.id]: _, ...rest }) => rest);
  };

  const sendComposer = async () => {
    const r = await run(() => api<{ route: "api" } | { route: "link"; url: string }>(`/conversations/${id}/reply`, { body: { body: composer } }));
    if (handleSend(r)) setComposer("");
  };

  const patch = (data: { category?: Category; stage?: Stage }) => run(() => api(`/conversations/${id}`, { method: "PATCH", body: data }), "Updated").then(refresh);

  const rerun = async () => {
    const r = await run(() => api<{ outcome: string }>(`/conversations/${id}/triage`, { body: {} }));
    if (!r) return;
    const messages: Record<string, string> = {
      drafted: "Sorted, and a reply is ready below.",
      triaged: "Sorted. No reply needed right now.",
      quota: "You've used this month's AI allowance.",
      inactive: "Renew your plan to use AI.",
      ai_off: "AI isn't switched on for this server yet.",
      empty: "No messages to read yet.",
    };
    toast(messages[r.outcome] ?? r.outcome, ["drafted", "triaged"].includes(r.outcome) ? "ok" : "error");
    refresh();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <button className="rounded p-1 hover:bg-slate-100 md:hidden" onClick={() => navigate("/inbox")} aria-label="Back">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{t.contact.name ?? displayPhone(t.contact.phone)}</div>
          <div className="text-xs text-slate-500">
            {displayPhone(t.contact.phone)}
            {t.contact.optedOut && <span className="ml-2 text-red-600">· opted out of broadcasts</span>}
          </div>
        </div>
        <select className="input w-auto py-1.5 text-xs" value={t.category} onChange={(e) => patch({ category: e.target.value as Category })}>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <select className="input w-auto py-1.5 text-xs" value={t.stage} onChange={(e) => patch({ stage: e.target.value as Stage })}>
          {STAGES.map((s) => (
            <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
        <button className="btn-ghost py-1.5 text-xs" onClick={rerun} disabled={busy || !me.billing.active}>
          ✨ Ask AI
        </button>
      </header>

      {(t.aiSummary || t.order) && (
        <div className="flex flex-col gap-2 border-b border-slate-100 bg-brand-50/60 px-4 py-2.5 text-xs sm:flex-row sm:items-start">
          {t.aiSummary && (
            <p className="min-w-0 text-slate-700 sm:flex-1">
              <span className="font-semibold text-brand-700">AI: </span>
              {t.aiSummary}
            </p>
          )}
          {t.order && (
            <div className="rounded-lg bg-white px-3 py-1.5 text-slate-700 shadow-sm">
              🧾 {t.order.items.map((i) => `${i.quantity}× ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ")}
              {t.order.deliveryLocation && ` → ${t.order.deliveryLocation}`}
              {t.order.totalGhs && <span className="font-semibold"> · {ghs(t.order.totalGhs)}</span>}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] px-3 py-4 md:px-6">
        {t.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === "OUTBOUND" ? "bg-[#d9fdd3]" : "bg-white"}`}>
              {m.mediaId && <Media message={m} cloud={t.sendRoute === "api"} />}
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              {!m.body && !m.mediaId && <p className="text-slate-400 italic">[{m.type}]</p>}
              <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-slate-500">
                {m.autoRuleId && <span>auto-reply ·</span>}
                {m.origin === "app" && m.direction === "OUTBOUND" && <span>from phone ·</span>}
                {new Date(m.timestamp).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {m.direction === "OUTBOUND" && <StatusTick status={m.status} />}
              </div>
              {m.status === "FAILED" && m.error && <p className="mt-1 text-[11px] text-red-600">{m.error}</p>}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {t.drafts.map((d) => (
        <div key={d.id} className="border-t border-brand-100 bg-brand-50 px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-brand-700">{d.kind === "FOLLOW_UP" ? "✨ Suggested follow-up" : "✨ Suggested reply"}</span>
            {d.status === "READY_TO_HAND_SEND" && <span className="text-slate-500">Opened in WhatsApp. Did you send it?</span>}
          </div>
          {d.status === "PENDING" ? (
            <>
              <textarea
                className="input min-h-20 bg-white"
                value={editing[d.id] ?? d.body}
                onChange={(e) => setEditing({ ...editing, [d.id]: e.target.value })}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => approve(d)} disabled={busy}>
                  {t.sendRoute === "api" ? "Approve & send" : "Approve & open WhatsApp"}
                </button>
                <button className="btn-ghost" onClick={() => run(() => api(`/drafts/${d.id}/reject`, { body: {} }), "Draft dismissed").then(refresh)} disabled={busy}>
                  Dismiss
                </button>
                {t.sendRoute === "api" && !t.windowOpen && (
                  <span className="self-center text-xs text-amber-700">24-hour window closed: only a template can be sent now.</span>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => run(() => api(`/drafts/${d.id}/hand-sent`, { body: {} }), "Marked as sent").then(refresh)}>
                Yes, I sent it
              </button>
              <button className="btn-ghost" onClick={async () => { const r = await run(() => api<{ url: string }>(`/drafts/${d.id}/link`)); if (r) window.open(r.url, "_blank", "noopener"); }}>
                Open WhatsApp again
              </button>
              <button className="btn-ghost" onClick={() => run(() => api(`/drafts/${d.id}/reject`, { body: {} })).then(refresh)}>
                I didn't send it
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-3">
        <textarea
          className="input max-h-40 min-h-10 flex-1 resize-none"
          rows={1}
          placeholder={t.sendRoute === "api" ? (t.windowOpen ? "Type a reply" : "24-hour window closed. Use a template from Broadcasts") : "Type a reply (opens in WhatsApp)"}
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && composer.trim()) {
              e.preventDefault();
              void sendComposer();
            }
          }}
        />
        <button className="btn-primary" disabled={busy || !composer.trim()} onClick={sendComposer}>
          Send
        </button>
      </div>
    </div>
  );
}

function StatusTick({ status }: { status: string }) {
  if (status === "FAILED") return <span className="text-red-600">!</span>;
  if (status === "READ") return <span className="text-sky-500">✓✓</span>;
  if (status === "DELIVERED") return <span>✓✓</span>;
  if (status === "QUEUED") return <span>🕓</span>;
  return <span>✓</span>;
}

function Media({ message, cloud }: { message: Message; cloud: boolean }) {
  if (!cloud) return <p className="text-slate-400 italic">[{message.type}]</p>;
  const src = `/api/media/${message.id}`;
  if (message.type === "image" || message.type === "sticker") return <img src={src} alt="" className="mb-1 max-h-64 rounded" loading="lazy" />;
  if (message.type === "audio") return <audio controls src={src} className="mb-1 w-60 max-w-full" preload="none" />;
  if (message.type === "video") return <video controls src={src} className="mb-1 max-h-64 rounded" preload="none" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-1 block text-brand-700 underline">
      📎 Open {message.type}
    </a>
  );
}

interface Preview {
  participants: Array<{ name: string; messages: number; phone: string | null }>;
  messages: number;
  from: string;
  to: string;
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [seller, setSeller] = useState("");
  const [phone, setPhone] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.endsWith(".txt")) return toast("Choose the .txt file from the export (unzip it first if it came as a .zip).", "error");
    const content = await file.text();
    setText(content);
    const p = await run(() => api<Preview>("/imports/preview", { body: { text: content } }));
    if (!p) return;
    setPreview(p);
    const customer = p.participants.find((x) => x.phone);
    if (customer?.phone) setPhone(`+${customer.phone}`);
    if (p.participants.length === 2 && customer) setSeller(p.participants.find((x) => x !== customer)!.name);
  };

  const submit = async () => {
    try {
      const r = await api<{ conversationId: string; stored: number; skippedOld: number; triage: string }>("/imports/chat", {
        body: { text, sellerName: seller, customerPhone: phone },
      });
      toast(`Imported ${r.stored} messages${r.skippedOld ? ` (${r.skippedOld} older ones skipped by your plan)` : ""}.`);
      onDone();
      onClose();
      navigate(`/inbox/${r.conversationId}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Import failed", "error");
    }
  };

  return (
    <Modal title="Import a WhatsApp chat" onClose={onClose}>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>On your phone, open the chat in WhatsApp.</li>
        <li>Tap ⋮ (or the contact name on iPhone) → More → <b>Export chat</b> → <b>Without media</b>.</li>
        <li>Save the file, then choose it here.</li>
      </ol>
      <input type="file" accept=".txt,text/plain" onChange={(e) => pick(e.target.files?.[0])} className="block w-full text-sm" />
      {preview && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate-500">
            {preview.messages} messages from {new Date(preview.from).toLocaleDateString()} to {new Date(preview.to).toLocaleDateString()}.
          </p>
          <div>
            <label className="label">Which one is you?</label>
            <select className="input" value={seller} onChange={(e) => setSeller(e.target.value)}>
              <option value="">Choose…</option>
              {preview.participants.map((p) => (
                <option key={p.name} value={p.name}>{p.name} ({p.messages} messages)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Customer's WhatsApp number</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 123 4567" />
          </div>
          <button className="btn-primary w-full" disabled={busy || !seller || !phone} onClick={submit}>
            Import & let AI sort it
          </button>
        </div>
      )}
    </Modal>
  );
}
