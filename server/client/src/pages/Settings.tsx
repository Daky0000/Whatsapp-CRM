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
    <div className="space-y-6">
      <PageHeader
        title="Workspace Settings"
        subtitle="Manage your WhatsApp number, Paystack payment link integration, AI voice, and team."
      />
      <div className="space-y-5">
        <WhatsAppConnection />
        <SellerPayments />
        <BusinessProfile />
        <Team />
        <ChangePassword />
      </div>
    </div>
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">WhatsApp Business Connection</h2>
          <p className="text-xs text-slate-500">Connect your WhatsApp number to automate replies, triage chats, and send broadcasts.</p>
        </div>
        {me.connection && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcf8c6] px-2.5 py-0.5 text-xs font-semibold text-[#075e54]">
            ● Connected
          </span>
        )}
      </div>

      {me.connection ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
          <div className="text-sm">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <span>{me.connection.mode === "CLOUD" ? "✅ Meta Cloud API (Live)" : "📥 Chat Export Mode"}</span>
              {me.connection.displayPhone && <span className="text-[#008069]">· {me.connection.displayPhone}</span>}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {me.connection.mode === "CLOUD"
                ? `${me.connection.verifiedName ? `${me.connection.verifiedName} · ` : ""}${
                    me.connection.coexistence ? "Coexistence mode active (you can keep using the WhatsApp Business app on your phone) · " : ""
                  }${me.connection.historySyncedAt ? `History synced ${new Date(me.connection.historySyncedAt).toLocaleDateString()}` : "Ready"}`
                : "Import chat exports from the Inbox; replies open in WhatsApp for you to send."}
            </div>
          </div>
          {isOwner && (
            <div className="flex gap-2">
              {me.connection.mode === "IMPORT" && cfg.data?.embeddedSignupReady && (
                <button className="btn-primary text-xs" onClick={connect} disabled={busy}>
                  Connect live
                </button>
              )}
              <button className="btn-danger text-xs" onClick={disconnect} disabled={busy}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-600">
            Use the number you already run on the <b>WhatsApp Business app</b>. You keep using the app on your phone. Inbound chats and order requests arrive here seamlessly.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button
              className="btn-whatsapp text-xs"
              onClick={connect}
              disabled={busy || !cfg.data?.embeddedSignupReady || !isOwner}
            >
              Connect WhatsApp Business App
            </button>
            <button className="btn-ghost text-xs" onClick={() => setManual(true)} disabled={!isOwner}>
              Connect with Meta API Token
            </button>
            <button className="btn-ghost text-xs" onClick={useImport} disabled={busy || !isOwner}>
              Start with chat exports instead
            </button>
          </div>
          {cfg.data && !cfg.data.embeddedSignupReady && (
            <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              Embedded Signup is waiting for Meta approval. Use <b>Connect with Meta API Token</b> above to link immediately.
            </div>
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
    if (await run(() => api("/whatsapp/manual", { body: form }), "WhatsApp connected!")) {
      await onDone();
      onClose();
    }
  };
  return (
    <Modal title="Connect WhatsApp with API Token" onClose={onClose}>
      <p className="mb-3 text-xs text-slate-500">
        From Meta's App Dashboard &rarr; WhatsApp &rarr; API Setup. Enter your token and Phone Number ID to link your number.
      </p>
      <div className="space-y-3">
        <div>
          <label className="label">Permanent Access Token</label>
          <input
            className="input font-mono text-xs"
            placeholder="EAAG..."
            value={form.accessToken}
            onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Phone Number ID</label>
          <input
            className="input text-xs"
            placeholder="104928374619284"
            value={form.phoneNumberId}
            onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
          />
        </div>
        <div>
          <label className="label">WhatsApp Business Account (WABA) ID</label>
          <input
            className="input text-xs"
            placeholder="984726153849102"
            value={form.wabaId}
            onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
          />
        </div>
        <button className="btn-primary mt-2 w-full text-xs" disabled={busy || !form.accessToken || !form.phoneNumberId || !form.wabaId} onClick={submit}>
          Connect WhatsApp Number
        </button>
      </div>
    </Modal>
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
      toast(r.live ? "Paystack connected! Payment links will take real money." : "Paystack TEST key connected. Links won't take real money.");
      setKey("");
      void status.reload();
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Get Paid in Chat (Paystack Payment Links)</h2>
          <p className="text-xs text-slate-500">
            Connect <b>your own</b> Paystack account so you can send Mobile Money or card payment links directly in WhatsApp conversations. The money goes straight to your Paystack.
          </p>
        </div>
        {status.data?.connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcf8c6] px-2.5 py-0.5 text-xs font-semibold text-[#075e54]">
            ● Connected
          </span>
        )}
      </div>

      {status.data?.connected ? (
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="font-semibold text-slate-800">✅ Your Paystack Merchant Account is Connected</div>
            <div className="mt-3">
              <label className="label">
                To update orders instantly when paid, paste this in Paystack &rarr; Settings &rarr; API Keys & Webhooks &rarr; Webhook URL:
              </label>
              <div className="flex gap-2">
                <input className="input font-mono text-xs" readOnly value={status.data.webhookUrl} onFocus={(e) => e.target.select()} />
                <button
                  className="btn-ghost shrink-0 text-xs"
                  onClick={() => navigator.clipboard.writeText(status.data!.webhookUrl).then(() => toast("Webhook URL copied!"))}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
          {isOwner && (
            <button
              className="btn-danger text-xs"
              disabled={busy}
              onClick={() =>
                confirm("Disconnect your Paystack? Existing links keep working, but new ones can't be made.") &&
                run(() => api("/payments/merchant-key", { method: "DELETE" }), "Paystack disconnected.").then(status.reload)
              }
            >
              Disconnect Paystack
            </button>
          )}
        </div>
      ) : isOwner ? (
        <div className="mt-4">
          <label className="label">Your Paystack Secret Key (sk_live_... or sk_test_...)</label>
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-md font-mono text-xs"
              placeholder="sk_live_... (from Paystack → Settings → API Keys & Webhooks)"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn-primary text-xs" disabled={busy || !key.trim()} onClick={save}>
              Connect Paystack
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Ask the shop owner to connect your store's Paystack.</p>
      )}
    </section>
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
      <h2 className="text-sm font-semibold text-slate-800">Business Profile & AI Personality</h2>
      <p className="mt-1 text-xs text-slate-500">The Claude AI writes customer replies and recommends products using these details.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Business Name</label>
          <input className="input text-xs" disabled={disabled} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Reply Voice / Tone</label>
          <select className="input text-xs" disabled={disabled} value={form.brandVoice} onChange={(e) => setForm({ ...form, brandVoice: e.target.value })}>
            <option value="friendly">Friendly: Warm, short, one emoji at most</option>
            <option value="casual">Ghanaian Casual: “Hello dear, it is available oo”</option>
            <option value="formal">Formal: Polite and professional</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">What do you sell? Who are your customers?</label>
          <textarea
            className="input min-h-20 text-xs"
            disabled={disabled}
            value={form.businessDescription}
            onChange={(e) => setForm({ ...form, businessDescription: e.target.value })}
            placeholder="Ladies' bags and shoes from Kantamanto, delivered across Accra. Mostly young working women."
          />
        </div>
        <div>
          <label className="label">Reply Language</label>
          <input className="input text-xs" disabled={disabled} value={form.replyLanguage} onChange={(e) => setForm({ ...form, replyLanguage: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Open (Accra Time)</label>
            <input className="input text-xs" type="time" disabled={disabled} value={form.hoursOpen} onChange={(e) => setForm({ ...form, hoursOpen: e.target.value })} />
          </div>
          <div>
            <label className="label">Close</label>
            <input className="input text-xs" type="time" disabled={disabled} value={form.hoursClose} onChange={(e) => setForm({ ...form, hoursClose: e.target.value })} />
          </div>
        </div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" disabled={disabled} checked={form.dailySummaryEmail} onChange={(e) => setForm({ ...form, dailySummaryEmail: e.target.checked })} />
        Email me a summary every morning at 7am (yesterday's chats, orders, and pending questions)
      </label>
      {!disabled && <button className="btn-primary mt-4 text-xs" onClick={save} disabled={busy}>Save Business Profile</button>}
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
    if (await run(() => api("/team", { body: form }), "Team member added! Share their password with them.")) {
      setAdding(false);
      void team.reload();
    }
  };
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Team Members</h2>
          <p className="text-xs text-slate-500">Shop assistants who can view chats and respond to customers.</p>
        </div>
        <span className="text-xs font-semibold text-[#008069]">{team.data?.users.length ?? 0} of {team.data?.seats ?? "…"} seats</span>
      </div>
      <ul className="mt-4 divide-y divide-slate-100 text-sm">
        {team.data?.users.map((u) => (
          <li key={u.id} className="flex items-center justify-between py-2.5">
            <div>
              <span className="font-semibold text-slate-900">{u.name}</span>
              <span className="ml-2 text-xs text-slate-500">{u.email}</span>
            </div>
            <span className="flex items-center gap-3 text-xs text-slate-500">
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                {u.role === "OWNER" ? "Owner" : "Assistant"}
              </span>
              {u.role !== "OWNER" && me.user.role === "OWNER" && (
                <button className="text-red-600 hover:underline" onClick={() => run(() => api(`/team/${u.id}`, { method: "DELETE" })).then(team.reload)}>
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {me.user.role === "OWNER" && (
        <button className="btn-ghost mt-4 text-xs" onClick={() => setAdding(true)}>
          Add Shop Assistant
        </button>
      )}
      {adding && (
        <Modal title="Add Shop Assistant" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <div><label className="label">Name</label><input className="input text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Email</label><input className="input text-xs" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="label">Password (8+ characters)</label><input className="input text-xs" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <button className="btn-primary mt-2 w-full text-xs" onClick={add} disabled={busy}>Add Assistant</button>
          </div>
        </Modal>
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
      <h2 className="text-sm font-semibold text-slate-800">Account Security</h2>
      <p className="text-xs text-slate-500">Update your account password.</p>
      <div className="mt-3 grid max-w-xl gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="input text-xs" type="password" placeholder="Current password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        <input className="input text-xs" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button className="btn-primary text-xs" disabled={busy || !form.current || form.password.length < 8} onClick={save}>Change Password</button>
      </div>
    </section>
  );
}
