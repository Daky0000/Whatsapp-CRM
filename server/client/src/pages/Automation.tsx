import { useState } from "react";
import { api, ghs } from "../api";
import { PageHeader, useAction, useLoad, useMe } from "../ui";

interface Rule {
  id: string;
  trigger: "KEYWORD" | "AWAY" | "WELCOME";
  keywords: string[];
  reply: string;
  active: boolean;
}
interface Product {
  id: string;
  name: string;
  priceGhs: string;
  description: string | null;
  inStock: boolean;
}
interface Faq {
  id: string;
  question: string;
  answer: string;
}

export default function AutomationPage() {
  return (
    <>
      <PageHeader title="AI & auto-replies" subtitle="What you put here is what the AI uses to answer customers, so the more accurate, the better the replies." />
      <div className="grid gap-4 lg:grid-cols-2">
        <AutoReplies />
        <Products />
        <Knowledge />
      </div>
    </>
  );
}

const TRIGGER_TEXT = {
  WELCOME: "Welcome message: sent once to someone messaging you for the first time",
  AWAY: "Away message: sent outside your business hours (at most every 12 hours per customer)",
  KEYWORD: "Keyword reply: sent when a message contains one of the words",
};

function AutoReplies() {
  const { me } = useMe();
  const rules = useLoad(() => api<Rule[]>("/auto-replies"));
  const [form, setForm] = useState({ trigger: "KEYWORD" as Rule["trigger"], keywords: "", reply: "" });
  const { busy, run } = useAction();
  const add = async () => {
    const ok = await run(
      () => api("/auto-replies", { body: { trigger: form.trigger, keywords: form.keywords.split(",").map((s) => s.trim()).filter(Boolean), reply: form.reply } }),
      "Auto-reply added",
    );
    if (ok) (setForm({ ...form, keywords: "", reply: "" }), void rules.reload());
  };
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Automatic replies</h2>
      <p className="mt-1 text-xs text-slate-500">
        Sent instantly, free (inside WhatsApp's 24-hour window). Business hours: {me.workspace.hoursOpen}–{me.workspace.hoursClose}, change them in Settings.
        {me.connection?.mode !== "CLOUD" && " Needs a Cloud API connection to send."}
      </p>
      <ul className="mt-3 space-y-2">
        {rules.data?.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">
                {r.trigger === "KEYWORD" ? `When a message mentions: ${r.keywords.join(", ")}` : r.trigger === "AWAY" ? "Away message" : "Welcome message"}
              </span>
              <span className="flex gap-3 text-xs">
                <button className="text-brand-700 hover:underline" onClick={() => run(() => api(`/auto-replies/${r.id}`, { method: "PATCH", body: { active: !r.active } })).then(rules.reload)}>
                  {r.active ? "Pause" : "Turn on"}
                </button>
                <button className="text-red-600 hover:underline" onClick={() => run(() => api(`/auto-replies/${r.id}`, { method: "DELETE" })).then(rules.reload)}>Delete</button>
              </span>
            </div>
            <p className={`mt-1 ${r.active ? "" : "text-slate-400 line-through"}`}>{r.reply}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
        <select className="input" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value as Rule["trigger"] })}>
          {(Object.keys(TRIGGER_TEXT) as Rule["trigger"][]).map((t) => (
            <option key={t} value={t}>{TRIGGER_TEXT[t]}</option>
          ))}
        </select>
        {form.trigger === "KEYWORD" && <input className="input" placeholder="Keywords, comma separated: price, how much, cost" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />}
        <textarea className="input" placeholder="The reply" value={form.reply} onChange={(e) => setForm({ ...form, reply: e.target.value })} />
        <button className="btn-primary" onClick={add} disabled={busy || !form.reply.trim()}>Add auto-reply</button>
      </div>
    </section>
  );
}

function Products() {
  const products = useLoad(() => api<Product[]>("/products"));
  const [form, setForm] = useState({ name: "", priceGhs: "", description: "" });
  const { busy, run } = useAction();
  const add = async () => {
    const ok = await run(() => api("/products", { body: { name: form.name, priceGhs: form.priceGhs, description: form.description || null } }), "Product added");
    if (ok) (setForm({ name: "", priceGhs: "", description: "" }), void products.reload());
  };
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Products & prices</h2>
      <p className="mt-1 text-xs text-slate-500">The AI only quotes prices from this list. It never makes one up.</p>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {products.data?.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className={p.inStock ? "" : "text-slate-400"}>{p.name}</div>
              {p.description && <div className="truncate text-xs text-slate-500">{p.description}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs">
              <span className="font-medium">{ghs(p.priceGhs)}</span>
              <button className="text-brand-700 hover:underline" onClick={() => run(() => api(`/products/${p.id}`, { method: "PATCH", body: { inStock: !p.inStock } })).then(products.reload)}>
                {p.inStock ? "Mark sold out" : "Back in stock"}
              </button>
              <button className="text-red-600 hover:underline" onClick={() => run(() => api(`/products/${p.id}`, { method: "DELETE" })).then(products.reload)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
        <input className="input col-span-2" placeholder="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Price (GHS)" inputMode="decimal" value={form.priceGhs} onChange={(e) => setForm({ ...form, priceGhs: e.target.value })} />
        <input className="input col-span-3" placeholder="Sizes, colours, details (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <button className="btn-primary mt-2" onClick={add} disabled={busy || !form.name || !form.priceGhs}>Add product</button>
    </section>
  );
}

function Knowledge() {
  const faq = useLoad(() => api<Faq[]>("/knowledge"));
  const [form, setForm] = useState({ question: "", answer: "" });
  const { busy, run } = useAction();
  const add = async () => {
    const ok = await run(() => api("/knowledge", { body: form }), "Saved");
    if (ok) (setForm({ question: "", answer: "" }), void faq.reload());
  };
  return (
    <section className="card p-5 lg:col-span-2">
      <h2 className="text-sm font-semibold">Business facts the AI should know</h2>
      <p className="mt-1 text-xs text-slate-500">Delivery areas and fees, payment methods (MoMo number), location, opening hours, returns.</p>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {faq.data?.map((k) => (
          <li key={k.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{k.question}</span>
              <button className="text-xs text-red-600 hover:underline" onClick={() => run(() => api(`/knowledge/${k.id}`, { method: "DELETE" })).then(faq.reload)}>Delete</button>
            </div>
            <p className="mt-1 text-slate-600">{k.answer}</p>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-2">
        <input className="input" placeholder="Question, e.g. Do you deliver to Kumasi?" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
        <input className="input" placeholder="Answer, e.g. Yes, GHS 40 via VIP bus, 1–2 days" value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
      </div>
      <button className="btn-primary mt-2" onClick={add} disabled={busy || !form.question || !form.answer}>Add fact</button>
    </section>
  );
}
