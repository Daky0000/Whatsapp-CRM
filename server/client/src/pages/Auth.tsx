import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAction } from "../ui";

export default function AuthPage({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [form, setForm] = useState({ name: "", businessName: "", email: "", password: "" });
  const { busy, run } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api(mode === "login" ? "/auth/login" : "/auth/signup", { body: form }));
    if (ok) onDone();
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-700 p-10 text-white md:flex">
        <div className="text-sm font-semibold opacity-90">DakyX · WhatsApp CRM</div>
        <div>
          <h1 className="text-3xl leading-tight font-semibold">Every WhatsApp order, sorted.<br />Every customer, answered.</h1>
          <ul className="mt-6 space-y-2 text-sm text-brand-100">
            <li>✓ AI sorts your chats into leads, orders and questions</li>
            <li>✓ Replies drafted for you. You approve with one tap</li>
            <li>✓ Contacts, broadcasts and auto-replies in one place</li>
            <li>✓ Pay with MoMo or card. From GHS 50/month</li>
          </ul>
        </div>
        <div className="text-xs opacity-70">7-day free trial of Pro. No card needed.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-xl font-semibold">{mode === "signup" ? "Start your free trial" : "Welcome back"}</h2>
            <p className="mt-1 text-sm text-slate-500">{mode === "signup" ? "Set up takes about 5 minutes." : "Sign in to your workspace."}</p>
          </div>
          {mode === "signup" && (
            <>
              <div>
                <label className="label">Your name</label>
                <input className="input" required value={form.name} onChange={set("name")} autoComplete="name" />
              </div>
              <div>
                <label className="label">Business name</label>
                <input className="input" required value={form.businessName} onChange={set("businessName")} placeholder="e.g. Ama's Bags & Shoes" />
              </div>
            </>
          )}
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required minLength={mode === "signup" ? 8 : 1} value={form.password} onChange={set("password")} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <p className="text-center text-sm text-slate-500">
            {mode === "signup" ? "Already have an account? " : "New here? "}
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
