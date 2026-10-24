import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAction, useLoad, useToast } from "../ui";

type Channel = "SMS" | "VOICE" | "WHATSAPP";
interface Channels {
  channels: Record<Channel, boolean>;
  mail: boolean;
}
const CHANNEL_LABEL: Record<Channel, string> = { SMS: "Text message", VOICE: "Phone call", WHATSAPP: "WhatsApp" };

export default function AuthPage({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("signup");
  const channels = useLoad(() => api<Channels>("/auth/otp/channels"));

  return (
    <div className="grid min-h-dvh md:grid-cols-2">
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
        <div className="w-full max-w-sm">
          {mode === "signup" && <Signup channels={channels.data} onDone={onDone} />}
          {mode === "login" && <Login onDone={onDone} onForgot={() => setMode("forgot")} />}
          {mode === "forgot" && <Forgot channels={channels.data} onDone={onDone} onBack={() => setMode("login")} />}
          {mode !== "forgot" && (
            <p className="mt-4 text-center text-sm text-slate-500">
              {mode === "signup" ? "Already have an account? " : "New here? "}
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
                {mode === "signup" ? "Sign in" : "Create an account"}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Login({ onDone, onForgot }: { onDone: () => void; onForgot: () => void }) {
  const [form, setForm] = useState({ identifier: "", password: "" });
  const { busy, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/auth/login", { body: form }))) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Welcome back</h2>
        <p className="mt-1 text-sm text-slate-500">Sign in with your email or phone number.</p>
      </div>
      <div>
        <label className="label">Email or phone</label>
        <input className="input" required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} autoComplete="username" placeholder="you@example.com or 024 123 4567" />
      </div>
      <div>
        <div className="flex justify-between">
          <label className="label">Password</label>
          <button type="button" className="mb-1 text-xs text-brand-700 hover:underline" onClick={onForgot}>Forgot password?</button>
        </div>
        <input className="input" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" />
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Please wait…" : "Sign in"}</button>
    </form>
  );
}

/** Code entry shared by sign-up and reset: pick how to receive it, resend after 30 seconds, show the USSD fallback. */
function CodeStep({
  phone,
  purpose,
  channels,
  sent,
  code,
  setCode,
  hedged,
}: {
  /** Reset flow: we don't confirm that the number has an account. */
  hedged?: boolean;
  phone: string;
  purpose: "signup" | "reset";
  channels: Record<Channel, boolean>;
  sent: { channel: Channel; ussdCode?: string };
  code: string;
  setCode: (v: string) => void;
}) {
  const [wait, setWait] = useState(30);
  const [current, setCurrent] = useState(sent);
  const { busy, run } = useAction();
  const toast = useToast();
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const resend = async (channel: Channel) => {
    const r = await run(() => api<{ channel: Channel; ussdCode?: string }>("/auth/otp/send", { body: { phone, purpose, channel } }));
    if (r) {
      setCurrent({ channel, ussdCode: r.ussdCode });
      setWait(30);
      toast(channel === "VOICE" ? "We're calling you with the code now." : `New code sent by ${CHANNEL_LABEL[channel].toLowerCase()}.`);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        {hedged && "If that number has an account, "}
        {current.channel === "VOICE" ? (hedged ? "we're calling" : "We're calling") : hedged ? "we've sent a 6-digit code to" : "We sent a 6-digit code to"}{" "}
        <b>{phone}</b>
        {current.channel === "WHATSAPP" ? " on WhatsApp" : current.channel === "VOICE" ? " to read you a 6-digit code" : " by text"}.
      </p>
      <input
        className="input text-center text-lg tracking-[0.5em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="••••••"
        autoFocus
      />
      {current.ussdCode && current.channel === "SMS" && (
        <p className="text-xs text-slate-500">SMS slow? Dial <b>{current.ussdCode}</b> to see your code.</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {wait > 0 ? (
          <span className="text-slate-500">Send again in {wait}s</span>
        ) : (
          (Object.keys(channels) as Channel[])
            .filter((c) => channels[c])
            .map((c) => (
              <button key={c} type="button" className="text-brand-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => resend(c)}>
                {c === current.channel ? "Send again" : `Get it by ${CHANNEL_LABEL[c].toLowerCase()}`}
              </button>
            ))
        )}
      </div>
    </div>
  );
}

function ChannelPicker({ channels, value, onChange }: { channels: Record<Channel, boolean>; value: Channel; onChange: (c: Channel) => void }) {
  const available = (Object.keys(channels) as Channel[]).filter((c) => channels[c]);
  if (available.length < 2) return null;
  return (
    <div>
      <label className="label">Send my code by</label>
      <div className="flex gap-2">
        {available.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${value === c ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}>
            {CHANNEL_LABEL[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Signup({ channels, onDone }: { channels: Channels | null; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", businessName: "", email: "", phone: "", password: "" });
  const [channel, setChannel] = useState<Channel>("SMS");
  const [sent, setSent] = useState<{ channel: Channel; ussdCode?: string } | null>(null);
  const [code, setCode] = useState("");
  const { busy, run } = useAction();
  const verify = !!channels && Object.values(channels.channels).some(Boolean);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (verify && !sent) {
      const r = await run(() => api<{ channel: Channel; ussdCode?: string }>("/auth/otp/send", { body: { phone: form.phone, purpose: "signup", channel } }));
      if (r) setSent({ channel: r.channel, ussdCode: r.ussdCode });
      return;
    }
    if (await run(() => api("/auth/signup", { body: { ...form, code: verify ? code : undefined } }))) onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{sent ? "Check your phone" : "Start your free trial"}</h2>
        <p className="mt-1 text-sm text-slate-500">{sent ? "Enter the code to finish creating your account." : "Set up takes about 5 minutes."}</p>
      </div>
      {sent && channels ? (
        <>
          <CodeStep phone={form.phone} purpose="signup" channels={channels.channels} sent={sent} code={code} setCode={setCode} />
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => (setSent(null), setCode(""))}>← Change my details</button>
        </>
      ) : (
        <>
          <div>
            <label className="label">Your name</label>
            <input className="input" required value={form.name} onChange={set("name")} autoComplete="name" />
          </div>
          <div>
            <label className="label">Business name</label>
            <input className="input" required value={form.businessName} onChange={set("businessName")} placeholder="e.g. Ama's Bags & Shoes" />
          </div>
          <div>
            <label className="label">Phone number</label>
            <input className="input" required type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" placeholder="024 123 4567" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required minLength={8} value={form.password} onChange={set("password")} autoComplete="new-password" />
          </div>
          {channels && <ChannelPicker channels={channels.channels} value={channel} onChange={setChannel} />}
        </>
      )}
      <button className="btn-primary w-full" disabled={busy || (!!sent && code.length < 6)}>
        {busy ? "Please wait…" : verify && !sent ? "Send my code" : "Create account"}
      </button>
    </form>
  );
}

function Forgot({ channels, onDone, onBack }: { channels: Channels | null; onDone: () => void; onBack: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [channel, setChannel] = useState<Channel>("SMS");
  const [stage, setStage] = useState<"ask" | "code" | "emailed">("ask");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const { busy, run } = useAction();
  const toast = useToast();
  const isEmail = identifier.includes("@");

  const request = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ via: "phone" | "email" }>("/auth/reset/request", { body: { identifier, channel } }));
    if (r) setStage(r.via === "email" ? "emailed" : "code");
  };
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/auth/reset/phone", { body: { phone: identifier, code, password } }))) {
      toast("Password changed. You're signed in.");
      onDone();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Reset your password</h2>
        <p className="mt-1 text-sm text-slate-500">
          {stage === "ask" ? `Enter your phone number${channels?.mail ? " or email" : ""}.` : stage === "emailed" ? "Check your email." : "Enter the code and a new password."}
        </p>
      </div>
      {stage === "ask" && (
        <form onSubmit={request} className="space-y-4">
          <input className="input" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={channels?.mail ? "024 123 4567 or you@example.com" : "024 123 4567"} autoComplete="username" />
          {!isEmail && channels && <ChannelPicker channels={channels.channels} value={channel} onChange={setChannel} />}
          <button className="btn-primary w-full" disabled={busy}>{isEmail ? "Email me a link" : "Send me a code"}</button>
        </form>
      )}
      {stage === "emailed" && <p className="text-sm text-slate-600">If an account uses <b>{identifier}</b>, a reset link is on its way. It works for one hour.</p>}
      {stage === "code" && channels && (
        <form onSubmit={confirm} className="space-y-4">
          <CodeStep hedged phone={identifier} purpose="reset" channels={channels.channels} sent={{ channel }} code={code} setCode={setCode} />
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <button className="btn-primary w-full" disabled={busy || code.length < 6}>Set new password</button>
        </form>
      )}
      <button type="button" className="text-sm text-brand-700 hover:underline" onClick={onBack}>← Back to sign in</button>
    </div>
  );
}

/** Opened from the reset email: /reset?token=… */
export function ResetFromLink() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/auth/reset/token", { body: { token, password } }))) setDone(true);
  };
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        {done ? (
          <>
            <p className="mt-2 text-sm text-slate-600">Done. Your password is changed and other devices have been signed out.</p>
            <a className="btn-primary mt-4 w-full" href="/">Go to my inbox</a>
          </>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
            <button className="btn-primary w-full" disabled={busy || !token}>Save password</button>
          </form>
        )}
      </div>
    </div>
  );
}
