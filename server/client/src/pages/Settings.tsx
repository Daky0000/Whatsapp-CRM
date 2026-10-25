import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal, PageHeader, useAction, useLoad, useMe, useToast } from "../ui";

interface SignupConfig {
  appId: string | null;
  configId: string | null;
  graphVersion: string;
  embeddedSignupReady: boolean;
}

declare global {
  interface Window {
    FB?: {
      init: (o: Record<string, unknown>) => void;
      login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-4">
        <WhatsAppConnection />
        <BusinessProfile />
        <SellerPayments />
        <Team />
        <ChangePassword />
      </div>
    </>
  );
}

function loadFacebookSdk(appId: string, version: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Couldn't load Facebook's sign-in. Check your connection."));
    document.body.appendChild(s);
  });
}

function WhatsAppConnection() {
  const { me, reload } = useMe();
  const toast = useToast();
  const cfg = useLoad(() => api<SignupConfig>("/whatsapp/config"));
  const { busy, run } = useAction();
  const [manual, setManual] = useState(false);
  const isOwner = me.user.role === "OWNER";

  /**
   * Meta's Embedded Signup. With featureType "whatsapp_business_app_onboarding"
   * a seller links the number they already use in the WhatsApp Business app
   * (Coexistence), keeps using the app, and Meta syncs recent chats to us.
   */
  const connect = async () => {
    const c = cfg.data;
    if (!c?.appId || !c.configId) return;
    try {
      await loadFacebookSdk(c.appId, c.graphVersion);
    } catch (err) {
      return toast((err as Error).message, "error");
    }
    let session: { phone_number_id?: string; waba_id?: string; coexistence: boolean } | null = null;
    const onMessage = (event: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(data.event).startsWith("FINISH")) {
          session = { ...data.data, coexistence: data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" };
        }
      } catch {
        /* not ours */
      }
    };
    window.addEventListener("message", onMessage);
    window.FB!.login(
      (response) => {
        // The session message can land just after the login callback.
        setTimeout(async () => {
          window.removeEventListener("message", onMessage);
          const code = response.authResponse?.code;
          const s = session as { phone_number_id?: string; waba_id?: string; coexistence: boolean } | null;
          if (!code || !s?.phone_number_id || !s.waba_id) return toast("WhatsApp connection was cancelled or didn't finish.", "error");
          const r = await run(() =>
            api<{ displayPhone: string | null; historyRequested: boolean }>("/whatsapp/embedded-signup", {
              body: { code, phoneNumberId: s.phone_number_id, wabaId: s.waba_id, coexistence: s.coexistence },
            }),
          );
          if (r) {
            toast(r.historyRequested ? "Connected! Your recent chats are syncing. This can take a few minutes." : "WhatsApp connected!");
            void reload();
          }
        }, 800);
      },
      {
        config_id: c.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  };

  const disconnect = async () => {
    if (!confirm("Disconnect WhatsApp? Your saved chats stay here, but new messages stop arriving.")) return;
    if (await run(() => api("/whatsapp", { method: "DELETE" }), "Disconnected")) void reload();
  };

  const useImport = async () => {
    if (await run(() => api("/whatsapp/import-mode", { body: {} }), "OK. Import chats from the Inbox, and replies will open in your WhatsApp.")) void reload();
  };

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">WhatsApp</h2>
      {me.connection ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">
              {me.connection.mode === "CLOUD" ? "✅ Connected" : "📥 Import mode"} {me.connection.displayPhone && `· ${me.connection.displayPhone}`}
            </div>
            <div className="text-xs text-slate-500">
              {me.connection.mode === "CLOUD"
                ? `${me.connection.verifiedName ?? ""}${me.connection.coexistence ? " · you can keep using the WhatsApp Business app on your phone" : ""}${me.connection.historySyncedAt ? ` · history synced ${new Date(me.connection.historySyncedAt).toLocaleDateString()}` : ""}`
                : "No live connection. Import chat exports from the Inbox, and approved replies open in WhatsApp for you to send."}
            </div>
          </div>
          {isOwner && (
            <div className="flex gap-2">
              {me.connection.mode === "IMPORT" && cfg.data?.embeddedSignupReady && <button className="btn-primary" onClick={connect} disabled={busy}>Connect live</button>}
              <button className="btn-danger" onClick={disconnect} disabled={busy}>Disconnect</button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-slate-600">
            Use the number you already run on the <b>WhatsApp Business app</b>. You keep using the app on your phone. Messages and your recent chats also arrive here.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={connect} disabled={busy || !cfg.data?.embeddedSignupReady || !isOwner}>
              Connect WhatsApp Business
            </button>
            <button className="btn-ghost" onClick={useImport} disabled={busy || !isOwner}>Start with chat exports instead</button>
            <button className="btn-ghost" onClick={() => setManual(true)} disabled={!isOwner}>Advanced: API token</button>
          </div>
          {cfg.data && !cfg.data.embeddedSignupReady && (
            <p className="text-xs text-amber-700">Live connection isn't switched on for this server yet (waiting on Meta approval). Start with chat exports for now.</p>
          )}
        </div>
      )}
      {manual && <ManualConnect onClose={() => setManual(false)} onDone={reload} />}
    </section>
  );
}

function ManualConnect({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ accessToken: "", phoneNumberId: "", wabaId: "" });
  const { busy, run } = useAction();
  const submit = async () => {
    if (await run(() => api("/whatsapp/manual", { body: form }), "WhatsApp connected")) (await onDone(), onClose());
  };
  return (
    <Modal title="Connect with an API token" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">For Meta's test number, or a number already set up through a WhatsApp partner. Find these in Meta's App Dashboard → WhatsApp → API Setup.</p>
      <div className="space-y-3">
        <div><label className="label">Permanent access token</label><input className="input" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} /></div>
        <div><label className="label">Phone number ID</label><input className="input" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} /></div>
        <div><label className="label">WhatsApp Business Account ID</label><input className="input" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} /></div>
        <button className="btn-primary w-full" disabled={busy} onClick={submit}>Connect</button>
      </div>
    </Modal>
  );
}

function BusinessProfile() {
  const { me, reload } = useMe();
  const [form, setForm] = useState({
    name: me.workspace.name,
    businessDescription: me.workspace.businessDescription ?? "",
    brandVoice: me.workspace.brandVoice,
    replyLanguage: me.workspace.replyLanguage,
    hoursOpen: me.workspace.hoursOpen,
    hoursClose: me.workspace.hoursClose,
    dailySummaryEmail: me.workspace.dailySummaryEmail,
  });
  const { busy, run } = useAction();
  const save = async () => {
    if (await run(() => api("/workspace", { method: "PUT", body: { ...form, businessDescription: form.businessDescription || null } }), "Saved")) void reload();
  };
  const disabled = me.user.role !== "OWNER";
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Your business</h2>
      <p className="mt-1 text-xs text-slate-500">The AI writes replies as you, using these details.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Business name</label>
          <input className="input" disabled={disabled} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Reply style</label>
          <select className="input" disabled={disabled} value={form.brandVoice} onChange={(e) => setForm({ ...form, brandVoice: e.target.value })}>
            <option value="friendly">Friendly: warm, short, one emoji at most</option>
            <option value="casual">Ghanaian casual: “Hello dear, it's available oo”</option>
            <option value="formal">Formal: polite and professional</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">What do you sell? Who are your customers?</label>
          <textarea className="input min-h-20" disabled={disabled} value={form.businessDescription} onChange={(e) => setForm({ ...form, businessDescription: e.target.value })} placeholder="Ladies' bags and shoes from Kantamanto, delivered across Accra. Mostly young working women." />
        </div>
        <div>
          <label className="label">Reply language</label>
          <input className="input" disabled={disabled} value={form.replyLanguage} onChange={(e) => setForm({ ...form, replyLanguage: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Open (Accra time)</label>
            <input className="input" type="time" disabled={disabled} value={form.hoursOpen} onChange={(e) => setForm({ ...form, hoursOpen: e.target.value })} />
          </div>
          <div>
            <label className="label">Close</label>
            <input className="input" type="time" disabled={disabled} value={form.hoursClose} onChange={(e) => setForm({ ...form, hoursClose: e.target.value })} />
          </div>
        </div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={disabled} checked={form.dailySummaryEmail} onChange={(e) => setForm({ ...form, dailySummaryEmail: e.target.checked })} />
        Email me a summary every morning at 7am (yesterday's chats and orders, and who's still waiting)
      </label>
      {!disabled && <button className="btn-primary mt-4" onClick={save} disabled={busy}>Save</button>}
    </section>
  );
}

function Team() {
  const { me } = useMe();
  const team = useLoad(() => api<{ users: Array<{ id: string; name: string; email: string; role: string }>; seats: number }>("/team"));
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [adding, setAdding] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => setForm({ name: "", email: "", password: "" }), [adding]);
  const add = async () => {
    if (await run(() => api("/team", { body: form }), "Team member added. Share their password with them.")) (setAdding(false), void team.reload());
  };
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Team</h2>
        <span className="text-xs text-slate-500">{team.data?.users.length ?? 0} of {team.data?.seats ?? "…"} seats</span>
      </div>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {team.data?.users.map((u) => (
          <li key={u.id} className="flex items-center justify-between py-2">
            <span>{u.name} <span className="text-xs text-slate-500">{u.email}</span></span>
            <span className="flex items-center gap-3 text-xs text-slate-500">
              {u.role === "OWNER" ? "Owner" : "Assistant"}
              {u.role !== "OWNER" && me.user.role === "OWNER" && (
                <button className="text-red-600 hover:underline" onClick={() => run(() => api(`/team/${u.id}`, { method: "DELETE" })).then(team.reload)}>Remove</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {me.user.role === "OWNER" && <button className="btn-ghost mt-3" onClick={() => setAdding(true)}>Add shop assistant</button>}
      {adding && (
        <Modal title="Add shop assistant" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="label">Password (8+ characters)</label><input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <button className="btn-primary w-full" onClick={add} disabled={busy}>Add</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SellerPayments() {
  const { me } = useMe();
  const status = useLoad(() => api<{ connected: boolean; webhookUrl: string }>("/payments"));
  const [key, setKey] = useState("");
  const { busy, run } = useAction();
  const toast = useToast();
  const isOwner = me.user.role === "OWNER";
  const save = async () => {
    const r = await run(() => api<{ live: boolean }>("/payments/merchant-key", { method: "PUT", body: { secretKey: key } }));
    if (r) {
      toast(r.live ? "Paystack connected. Payment links will take real money." : "Paystack TEST key connected. Links won't take real money.");
      setKey("");
      void status.reload();
    }
  };
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Get paid in chat</h2>
      <p className="mt-1 text-xs text-slate-500">
        Connect <b>your own</b> Paystack account to send customers a Mobile Money or card payment link from any order. The money goes straight to your Paystack, not through DakyX.
      </p>
      {status.data?.connected ? (
        <div className="mt-3 space-y-3 text-sm">
          <p>✅ Your Paystack is connected.</p>
          <div>
            <label className="label">So paid orders update instantly, paste this in Paystack → Settings → API Keys & Webhooks → Webhook URL</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={status.data.webhookUrl} onFocus={(e) => e.target.select()} />
              <button className="btn-ghost shrink-0" onClick={() => navigator.clipboard.writeText(status.data!.webhookUrl).then(() => toast("Copied"))}>Copy</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Without it, payments are still picked up, within about 10 minutes.</p>
          </div>
          {isOwner && (
            <button className="btn-danger" disabled={busy} onClick={() => confirm("Disconnect your Paystack? Existing links keep working, but new ones can't be made.") && run(() => api("/payments/merchant-key", { method: "DELETE" }), "Disconnected").then(status.reload)}>
              Disconnect Paystack
            </button>
          )}
        </div>
      ) : isOwner ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input max-w-md font-mono text-xs" placeholder="sk_live_…  (Paystack → Settings → API Keys & Webhooks)" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn-primary" disabled={busy || !key.trim()} onClick={save}>Connect</button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Ask the owner to connect Paystack.</p>
      )}
    </section>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ current: "", password: "" });
  const { busy, run } = useAction();
  const save = async () => {
    if (await run(() => api("/auth/password", { body: form }), "Password changed. Other devices have been signed out.")) setForm({ current: "", password: "" });
  };
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Your password</h2>
      <div className="mt-3 grid max-w-xl gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="input" type="password" placeholder="Current password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        <input className="input" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button className="btn-primary" disabled={busy || !form.current || form.password.length < 8} onClick={save}>Change</button>
      </div>
    </section>
  );
}
