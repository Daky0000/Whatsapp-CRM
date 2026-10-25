import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  displayPhone,
  ghs,
  type AdminOverview,
  type PlatformConfig,
} from "../api";
import { Modal, PageHeader, useAction, useLoad, useMe, useToast } from "../ui";

interface WorkspaceRow {
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

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

type AdminTab = "overview" | "workspaces" | "whatsapp" | "paystack" | "integrations";

export default function AdminPage() {
  const { me, reload: reloadMe } = useMe();
  const [tab, setTab] = useState<AdminTab>("overview");
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {/* Top Banner & Mode Switcher */}
      <div className="flex flex-col gap-4 rounded-2xl border border-[#00a884]/30 bg-gradient-to-r from-[#008069] to-[#075e54] p-5 text-white shadow-md sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 items-center rounded-full bg-[#25d366]/20 px-2.5 py-0.5 text-xs font-semibold text-[#25d366]">
              ● SUPERADMIN CONSOLE
            </span>
            <span className="text-xs text-white/70">
              Workspace: <b>{me.workspace.name}</b>
            </span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-white">
            DakyX Platform Administration
          </h1>
          <p className="text-xs text-white/80">
            Global system config, tenant workspaces, WhatsApp Cloud API & Paystack gateway.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-[#075e54] shadow-sm transition hover:bg-slate-100"
          >
            <span>👤</span>
            <span>Switch to Workspace CRM</span>
          </button>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="flex flex-wrap border-b border-slate-200 gap-1">
        <TabButton
          active={tab === "overview"}
          onClick={() => setTab("overview")}
          icon="📊"
          label="Platform Overview"
        />
        <TabButton
          active={tab === "workspaces"}
          onClick={() => setTab("workspaces")}
          icon="🏢"
          label="Workspaces & Tenants"
        />
        <TabButton
          active={tab === "whatsapp"}
          onClick={() => setTab("whatsapp")}
          icon="💬"
          label="WhatsApp Cloud API"
        />
        <TabButton
          active={tab === "paystack"}
          onClick={() => setTab("paystack")}
          icon="💳"
          label="Paystack Gateway"
        />
        <TabButton
          active={tab === "integrations"}
          onClick={() => setTab("integrations")}
          icon="⚡"
          label="AI & Gateways"
        />
      </div>

      {/* Tab Contents */}
      {tab === "overview" && <OverviewTab onNavigate={setTab} />}
      {tab === "workspaces" && <WorkspacesTab onSwitchWorkspace={reloadMe} />}
      {tab === "whatsapp" && <WhatsAppConfigTab />}
      {tab === "paystack" && <PaystackConfigTab />}
      {tab === "integrations" && <IntegrationsConfigTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-medium transition ${
        active
          ? "border-b-2 border-[#008069] bg-white text-[#008069] font-semibold"
          : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// -----------------------------------------------------------------------------
// OVERVIEW TAB
// -----------------------------------------------------------------------------

function OverviewTab({ onNavigate }: { onNavigate: (tab: AdminTab) => void }) {
  const overview = useLoad(() => api<AdminOverview>("/admin/overview"));
  const data = overview.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Workspaces"
          value={data ? data.totalWorkspaces : "…"}
          sub={data ? `${data.payingWorkspaces} paying · ${data.trialWorkspaces} on trial` : ""}
          accent="text-slate-900"
        />
        <StatCard
          label="Monthly Recurring Revenue"
          value={data ? ghs(data.mrrGhs) : "…"}
          sub="From active paid subscriptions"
          accent="text-[#008069]"
        />
        <StatCard
          label="Total Messages Handled"
          value={data ? data.totalMessages.toLocaleString() : "…"}
          sub={data ? `${data.totalConversations.toLocaleString()} active conversations` : ""}
          accent="text-slate-900"
        />
        <StatCard
          label="WhatsApp Live Connections"
          value={data ? data.connectedCloud : "…"}
          sub={data ? `${data.connectedImport} in chat export mode` : ""}
          accent="text-[#25d366]"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Customer Contacts"
          value={data ? data.totalContacts.toLocaleString() : "…"}
          sub="Across all merchant stores"
        />
        <StatCard
          label="AI Triages Automated"
          value={data ? data.totalAiTriages.toLocaleString() : "…"}
          sub="Auto-categorized inquiries & orders"
        />
        <StatCard
          label="Paying Merchants"
          value={data ? data.payingWorkspaces : "…"}
          sub="Generating live revenue"
        />
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800">Quick Configuration Shortcuts</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction
            title="WhatsApp Cloud API"
            desc="Set Meta App ID, Token & Webhook"
            icon="💬"
            onClick={() => onNavigate("whatsapp")}
          />
          <QuickAction
            title="Paystack Payments"
            desc="Configure live/test keys & MoMo"
            icon="💳"
            onClick={() => onNavigate("paystack")}
          />
          <QuickAction
            title="Workspaces & Sellers"
            desc="Inspect, extend & switch workspaces"
            icon="🏢"
            onClick={() => onNavigate("workspaces")}
          />
          <QuickAction
            title="AI & Gateways"
            desc="Claude AI & Vynfy SMS settings"
            icon="⚡"
            onClick={() => onNavigate("integrations")}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent = "text-slate-900",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${accent}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function QuickAction({
  title,
  desc,
  icon,
  onClick,
}: {
  title: string;
  desc: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col text-left rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 transition hover:border-[#00a884] hover:bg-white hover:shadow-xs"
    >
      <span className="text-2xl">{icon}</span>
      <span className="mt-2 text-xs font-semibold text-slate-800">{title}</span>
      <span className="mt-0.5 text-[11px] text-slate-500">{desc}</span>
    </button>
  );
}

// -----------------------------------------------------------------------------
// WORKSPACES TAB
// -----------------------------------------------------------------------------

function WorkspacesTab({ onSwitchWorkspace }: { onSwitchWorkspace: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "paying" | "trial" | "ended">("all");
  const rows = useLoad(() => api<WorkspaceRow[]>(`/admin/workspaces?q=${encodeURIComponent(q)}`), [q]);
  const [extending, setExtending] = useState<WorkspaceRow | null>(null);
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const toast = useToast();

  const all = rows.data ?? [];
  const filtered = all.filter((r) => {
    if (filter === "paying") return r.status === "ACTIVE" && !r.staff;
    if (filter === "trial") return r.status === "TRIALING" && r.active;
    if (filter === "ended") return !r.active;
    return true;
  });

  const handleSwitchWorkspace = async (w: WorkspaceRow) => {
    const res = await run(
      () => api<{ ok: boolean; workspaceName: string }>(`/admin/switch-workspace/${w.id}`),
      `Switched to ${w.name}`,
    );
    if (res?.ok) {
      await onSwitchWorkspace();
      navigate("/");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          className="input max-w-sm"
          placeholder="Search business, email or phone..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1 text-xs">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")} label={`All (${all.length})`} />
          <FilterPill
            active={filter === "paying"}
            onClick={() => setFilter("paying")}
            label={`Paying (${all.filter((r) => r.status === "ACTIVE" && !r.staff).length})`}
          />
          <FilterPill
            active={filter === "trial"}
            onClick={() => setFilter("trial")}
            label={`Trial (${all.filter((r) => r.status === "TRIALING" && r.active).length})`}
          />
          <FilterPill
            active={filter === "ended"}
            onClick={() => setFilter("ended")}
            label={`Ended (${all.filter((r) => !r.active).length})`}
          />
        </div>
      </div>

      <div className="card overflow-x-auto shadow-xs">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="p-3.5">Business</th>
              <th className="p-3.5">Owner</th>
              <th className="p-3.5">Plan</th>
              <th className="p-3.5">Valid Until</th>
              <th className="p-3.5">WhatsApp</th>
              <th className="p-3.5 text-right">Chats</th>
              <th className="p-3.5 text-right">Paid</th>
              <th className="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <tr key={r.id} className="align-middle transition hover:bg-slate-50/60">
                <td className="p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{r.name}</span>
                    {r.staff && (
                      <span className="rounded bg-[#008069]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#008069]">
                        staff
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400">since {date(r.createdAt)}</div>
                </td>
                <td className="p-3.5 text-xs">
                  <div className="font-medium text-slate-800">{r.owner?.name ?? "—"}</div>
                  <div className="text-slate-500">{r.owner?.email ?? "—"}</div>
                  {r.owner?.phone && <div className="text-slate-400">{displayPhone(r.owner.phone)}</div>}
                </td>
                <td className="p-3.5 text-xs">
                  <span className="font-medium text-slate-800">
                    {r.status === "TRIALING" ? "Trial" : r.plan === "PRO" ? "Pro" : "Starter"}
                  </span>
                  <div>
                    <span
                      className={`inline-block text-[11px] font-medium ${
                        r.active ? "text-[#008069]" : "text-red-500"
                      }`}
                    >
                      {r.active ? r.status.toLowerCase().replace("_", " ") : "ended"}
                    </span>
                  </div>
                </td>
                <td className="p-3.5 text-xs whitespace-nowrap text-slate-600">
                  {date(r.status === "TRIALING" ? r.trialEndsAt : r.currentPeriodEnd)}
                </td>
                <td className="p-3.5 text-xs">
                  {r.connection ? (
                    <span className="inline-flex items-center gap-1.5 text-slate-800">
                      <span className="h-2 w-2 rounded-full bg-[#25d366]" />
                      <span>{r.connection.mode === "CLOUD" ? "Live" : "Import"}</span>
                      {r.connection.displayPhone && (
                        <span className="text-slate-500">· {r.connection.displayPhone}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-400">not connected</span>
                  )}
                </td>
                <td className="p-3.5 text-right text-xs tabular-nums text-slate-700">
                  <span className="font-semibold">{r.conversations}</span>
                  <div className="text-[11px] text-slate-400">{r.aiSortedThisMonth} AI sorted</div>
                </td>
                <td className="p-3.5 text-right text-xs font-semibold tabular-nums text-slate-800">
                  {ghs(r.paidGhs)}
                </td>
                <td className="p-3.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                      onClick={() => handleSwitchWorkspace(r)}
                      disabled={busy}
                      title="Switch active session to this workspace"
                    >
                      Open CRM
                    </button>
                    {!r.staff && (
                      <button
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-[#008069] hover:bg-[#008069]/10"
                        onClick={() => setExtending(r)}
                      >
                        Extend
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-slate-400">
                  No workspaces found matching your query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {extending && (
        <ExtendModal row={extending} onClose={() => setExtending(null)} onDone={rows.reload} />
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 transition ${
        active ? "bg-[#008069] font-medium text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

function ExtendModal({ row, onClose, onDone }: { row: WorkspaceRow; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<"STARTER" | "PRO">(row.plan);
  const [days, setDays] = useState(30);
  const { busy, run } = useAction();
  const submit = async () => {
    if (
      await run(
        () => api(`/admin/workspaces/${row.id}/extend`, { body: { plan, days } }),
        `${row.name} extended by ${days} days`,
      )
    ) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal title={`Extend Subscription: ${row.name}`} onClose={onClose}>
      <p className="mb-4 text-xs text-slate-500">
        Gives full access without a payment. Ideal for courtesy extensions or MoMo payments confirmed manually.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Plan Tier</label>
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value as "STARTER" | "PRO")}>
            <option value="STARTER">Starter</option>
            <option value="PRO">Pro</option>
          </select>
        </div>
        <div>
          <label className="label">Extension Days</label>
          <input
            className="input"
            type="number"
            min={1}
            max={366}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </div>
      </div>
      <button className="btn-primary mt-5 w-full" disabled={busy} onClick={submit}>
        Confirm Extension
      </button>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// WHATSAPP CLOUD API CONFIG TAB
// -----------------------------------------------------------------------------

function WhatsAppConfigTab() {
  const configQuery = useLoad(() => api<PlatformConfig>("/admin/settings"));
  const { busy, run } = useAction();
  const toast = useToast();

  const [form, setForm] = useState({
    appId: "",
    appSecret: "",
    configId: "",
    verifyToken: "",
    graphVersion: "v23.0",
    accessToken: "",
    phoneNumberId: "",
    wabaId: "",
  });

  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; details?: Record<string, unknown> } | null>(null);

  // Sync initial values when loaded
  const data = configQuery.data?.whatsapp;
  useState(() => {
    if (data) {
      setForm({
        appId: data.appId ?? "",
        appSecret: "",
        configId: data.configId ?? "",
        verifyToken: data.verifyToken ?? "",
        graphVersion: data.graphVersion ?? "v23.0",
        accessToken: "",
        phoneNumberId: data.phoneNumberId ?? "",
        wabaId: data.wabaId ?? "",
      });
    }
  });

  const save = async () => {
    const body: Record<string, unknown> = {
      appId: form.appId,
      configId: form.configId,
      verifyToken: form.verifyToken,
      graphVersion: form.graphVersion,
      phoneNumberId: form.phoneNumberId,
      wabaId: form.wabaId,
    };
    if (form.appSecret.trim()) body.appSecret = form.appSecret.trim();
    if (form.accessToken.trim()) body.accessToken = form.accessToken.trim();

    const res = await run(() => api("/admin/settings", { method: "PUT", body: { whatsapp: body } }), "WhatsApp configuration saved!");
    if (res) {
      setForm((prev) => ({ ...prev, appSecret: "", accessToken: "" }));
      void configQuery.reload();
    }
  };

  const testConnection = async () => {
    setTestResult(null);
    try {
      const res = await run(() =>
        api<{ ok: boolean; displayPhone?: string; verifiedName?: string; qualityRating?: string; name?: string; status?: string }>(
          "/admin/test/whatsapp",
          { body: { accessToken: form.accessToken || undefined, phoneNumberId: form.phoneNumberId || undefined } },
        ),
      );
      if (res?.ok) {
        setTestResult({
          ok: true,
          message: res.displayPhone
            ? `Verified Live! Phone: ${res.displayPhone} (${res.verifiedName ?? "Verified"}) · Quality: ${res.qualityRating ?? "GREEN"}`
            : `Token verified for Meta account: ${res.name ?? "Active"}`,
        });
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast(`${label} copied to clipboard!`);
  };

  return (
    <div className="space-y-5">
      {/* Live Status & Test Banner */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${data?.hasAccessToken ? "bg-[#25d366]" : "bg-amber-400"}`} />
              <span className="text-sm font-semibold text-slate-800">
                {data?.hasAccessToken ? "WhatsApp Cloud API Configured" : "Access Token Needed"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {data?.hasAccessToken
                ? `System token active (${data.accessTokenMasked}) · Graph API ${data.graphVersion}`
                : "Enter a permanent system user token or connect via Embedded Signup below."}
            </p>
          </div>
          <button className="btn-whatsapp text-xs" onClick={testConnection} disabled={busy}>
            Test Meta API Connection
          </button>
        </div>

        {testResult && (
          <div
            className={`mt-4 rounded-xl p-3.5 text-xs font-medium ${
              testResult.ok ? "border border-[#00a884]/30 bg-[#eef9f3] text-[#008069]" : "border border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {testResult.ok ? "✅ " : "⚠️ "}
            {testResult.message}
          </div>
        )}
      </div>

      {/* Webhook Endpoint Card */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800">Meta Webhook Configuration</h2>
        <p className="mt-1 text-xs text-slate-500">
          In <b>Meta App Dashboard &rarr; WhatsApp &rarr; Configuration</b>, set your Webhook URL and Verify Token:
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Webhook Callback URL</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={data?.webhookUrl ?? "https://whatsapp.dakyx.com/api/webhooks/whatsapp"} />
              <button
                className="btn-ghost shrink-0 text-xs"
                onClick={() => copyToClipboard(data?.webhookUrl ?? "https://whatsapp.dakyx.com/api/webhooks/whatsapp", "Webhook URL")}
              >
                Copy
              </button>
            </div>
          </div>
          <div>
            <label className="label">Webhook Verify Token</label>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                value={form.verifyToken || data?.verifyToken || ""}
                onChange={(e) => setForm({ ...form, verifyToken: e.target.value })}
                placeholder="Custom token or verify token"
              />
              <button
                className="btn-ghost shrink-0 text-xs"
                onClick={() => copyToClipboard(form.verifyToken || data?.verifyToken || "", "Verify Token")}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Subscribe to the webhook fields: <b>messages</b> and <b>message_deliveries</b>.
        </p>
      </div>

      {/* Meta Credentials Form */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800">Meta Cloud API Credentials</h2>
        <p className="mt-1 text-xs text-slate-500">
          Found in <b>developers.facebook.com &rarr; My Apps &rarr; App Settings / WhatsApp Setup</b>.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Meta App ID</label>
            <input
              className="input text-xs"
              placeholder="e.g. 109283746592817"
              value={form.appId || data?.appId || ""}
              onChange={(e) => setForm({ ...form, appId: e.target.value })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label">Meta App Secret</label>
              {data?.hasAppSecret && (
                <span className="text-[11px] text-[#008069] font-medium">Currently set ({data.appSecretMasked})</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                type={showSecret ? "text" : "password"}
                placeholder={data?.hasAppSecret ? "Leave blank to keep current secret" : "Enter App Secret"}
                value={form.appSecret}
                onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Meta Config ID (Embedded Signup)</label>
            <input
              className="input text-xs"
              placeholder="e.g. 293847561029384"
              value={form.configId || data?.configId || ""}
              onChange={(e) => setForm({ ...form, configId: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Graph API Version</label>
            <input
              className="input text-xs"
              placeholder="v23.0"
              value={form.graphVersion || data?.graphVersion || "v23.0"}
              onChange={(e) => setForm({ ...form, graphVersion: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Default Phone Number ID</label>
            <input
              className="input text-xs"
              placeholder="e.g. 104928374619284"
              value={form.phoneNumberId || data?.phoneNumberId || ""}
              onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
            />
          </div>

          <div>
            <label className="label">WhatsApp Business Account (WABA) ID</label>
            <input
              className="input text-xs"
              placeholder="e.g. 984726153849102"
              value={form.wabaId || data?.wabaId || ""}
              onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="label">Permanent System Access Token</label>
              {data?.hasAccessToken && (
                <span className="text-[11px] text-[#008069] font-medium">Currently set ({data.accessTokenMasked})</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                type={showToken ? "text" : "password"}
                placeholder={data?.hasAccessToken ? "Leave blank to keep current token" : "EAAG..."}
                value={form.accessToken}
                onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button className="btn-primary" onClick={save} disabled={busy}>
            Save WhatsApp Configuration
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// PAYSTACK GATEWAY CONFIG TAB
// -----------------------------------------------------------------------------

function PaystackConfigTab() {
  const configQuery = useLoad(() => api<PlatformConfig>("/admin/settings"));
  const { busy, run } = useAction();
  const toast = useToast();

  const data = configQuery.data?.paystack;

  const [form, setForm] = useState({
    mode: "live" as "live" | "test",
    liveSecretKey: "",
    livePublicKey: "",
    testSecretKey: "",
    testPublicKey: "",
    starterPriceGhs: 50,
    proPriceGhs: 150,
  });

  const [showLiveSecret, setShowLiveSecret] = useState(false);
  const [showTestSecret, setShowTestSecret] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Sync initial values when loaded
  useState(() => {
    if (data) {
      setForm({
        mode: data.mode ?? "live",
        liveSecretKey: "",
        livePublicKey: data.livePublicKey ?? "",
        testSecretKey: "",
        testPublicKey: data.testPublicKey ?? "",
        starterPriceGhs: data.starterPriceGhs ?? 50,
        proPriceGhs: data.proPriceGhs ?? 150,
      });
    }
  });

  const save = async () => {
    const body: Record<string, unknown> = {
      mode: form.mode,
      livePublicKey: form.livePublicKey,
      testPublicKey: form.testPublicKey,
      starterPriceGhs: Number(form.starterPriceGhs),
      proPriceGhs: Number(form.proPriceGhs),
    };
    if (form.liveSecretKey.trim()) body.liveSecretKey = form.liveSecretKey.trim();
    if (form.testSecretKey.trim()) body.testSecretKey = form.testSecretKey.trim();

    const res = await run(() => api("/admin/settings", { method: "PUT", body: { paystack: body } }), "Paystack configuration saved!");
    if (res) {
      setForm((prev) => ({ ...prev, liveSecretKey: "", testSecretKey: "" }));
      void configQuery.reload();
    }
  };

  const testConnection = async () => {
    setTestResult(null);
    try {
      const res = await run(() =>
        api<{ ok: boolean; mode: string; balances?: Array<{ currency: string; balance: number }> }>(
          "/admin/test/paystack",
          { body: { mode: form.mode, secretKey: (form.mode === "live" ? form.liveSecretKey : form.testSecretKey) || undefined } },
        ),
      );
      if (res?.ok) {
        const bal = res.balances?.[0];
        setTestResult({
          ok: true,
          message: `Paystack API Verified (${res.mode.toUpperCase()})! ${
            bal ? `Balance: ${bal.currency} ${(bal.balance / 100).toLocaleString()}` : "API Connected"
          }`,
        });
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast(`${label} copied to clipboard!`);
  };

  return (
    <div className="space-y-5">
      {/* Status & Test Card */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${data?.hasLiveSecret ? "bg-[#25d366]" : "bg-amber-400"}`} />
              <span className="text-sm font-semibold text-slate-800">
                Paystack Gateway: <span className="uppercase text-[#008069]">{data?.mode ?? "LIVE"}</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {data?.hasLiveSecret
                ? `Live Key: ${data.liveSecretMasked} · Accepts Mobile Money (MTN, Telecel, AT) and Visa/Mastercard`
                : "No live secret key configured yet."}
            </p>
          </div>
          <button className="btn-primary text-xs" onClick={testConnection} disabled={busy}>
            Test Paystack API Ping
          </button>
        </div>

        {testResult && (
          <div
            className={`mt-4 rounded-xl p-3.5 text-xs font-medium ${
              testResult.ok ? "border border-[#00a884]/30 bg-[#eef9f3] text-[#008069]" : "border border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {testResult.ok ? "✅ " : "⚠️ "}
            {testResult.message}
          </div>
        )}
      </div>

      {/* Webhook Endpoint Card */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800">Paystack Webhook URL</h2>
        <p className="mt-1 text-xs text-slate-500">
          In <b>Paystack Dashboard &rarr; Settings &rarr; API Keys & Webhooks</b>, set your Webhook URL:
        </p>
        <div className="mt-3 flex gap-2">
          <input className="input font-mono text-xs" readOnly value={data?.webhookUrl ?? "https://whatsapp.dakyx.com/api/webhooks/paystack"} />
          <button
            className="btn-ghost shrink-0 text-xs"
            onClick={() => copyToClipboard(data?.webhookUrl ?? "https://whatsapp.dakyx.com/api/webhooks/paystack", "Webhook URL")}
          >
            Copy
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Enables real-time webhook confirmation for subscriptions, renewals, and wallet credits.
        </p>
      </div>

      {/* Paystack Credentials Form */}
      <div className="card p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Paystack Environment & Keys</h2>
            <p className="text-xs text-slate-500">Switch mode or update your Paystack API keys.</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
            <button
              onClick={() => setForm({ ...form, mode: "live" })}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                (form.mode || data?.mode) === "live"
                  ? "bg-[#008069] text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Live Mode
            </button>
            <button
              onClick={() => setForm({ ...form, mode: "test" })}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                (form.mode || data?.mode) === "test"
                  ? "bg-amber-500 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Test Mode
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Live Secret Key (sk_live_...)</label>
              {data?.hasLiveSecret && (
                <span className="text-[11px] text-[#008069] font-medium">{data.liveSecretMasked}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                type={showLiveSecret ? "text" : "password"}
                placeholder={data?.hasLiveSecret ? "Leave blank to keep current key" : "sk_live_..."}
                value={form.liveSecretKey}
                onChange={(e) => setForm({ ...form, liveSecretKey: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setShowLiveSecret(!showLiveSecret)}
              >
                {showLiveSecret ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Live Public Key (pk_live_...)</label>
            <input
              className="input font-mono text-xs"
              placeholder="pk_live_..."
              value={form.livePublicKey || data?.livePublicKey || ""}
              onChange={(e) => setForm({ ...form, livePublicKey: e.target.value })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label">Test Secret Key (sk_test_...)</label>
              {data?.hasTestSecret && (
                <span className="text-[11px] text-amber-600 font-medium">{data.testSecretMasked}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                type={showTestSecret ? "text" : "password"}
                placeholder={data?.hasTestSecret ? "Leave blank to keep current key" : "sk_test_..."}
                value={form.testSecretKey}
                onChange={(e) => setForm({ ...form, testSecretKey: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setShowTestSecret(!showTestSecret)}
              >
                {showTestSecret ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Test Public Key (pk_test_...)</label>
            <input
              className="input font-mono text-xs"
              placeholder="pk_test_..."
              value={form.testPublicKey || data?.testPublicKey || ""}
              onChange={(e) => setForm({ ...form, testPublicKey: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Starter Plan Monthly Price (GHS)</label>
            <input
              className="input text-xs"
              type="number"
              value={form.starterPriceGhs || data?.starterPriceGhs || 50}
              onChange={(e) => setForm({ ...form, starterPriceGhs: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="label">Pro Plan Monthly Price (GHS)</label>
            <input
              className="input text-xs"
              type="number"
              value={form.proPriceGhs || data?.proPriceGhs || 150}
              onChange={(e) => setForm({ ...form, proPriceGhs: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button className="btn-primary" onClick={save} disabled={busy}>
            Save Paystack Configuration
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// AI & GATEWAYS CONFIG TAB
// -----------------------------------------------------------------------------

function IntegrationsConfigTab() {
  const configQuery = useLoad(() => api<PlatformConfig>("/admin/settings"));
  const { busy, run } = useAction();

  const data = configQuery.data;

  const [aiForm, setAiForm] = useState({
    apiKey: "",
    triageModel: "claude-opus-5-5",
    draftModel: "claude-opus-5-5",
  });
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [vynfyForm, setVynfyForm] = useState({
    apiKey: "",
    senderId: "DakyXTech",
  });
  const [showVynfyKey, setShowVynfyKey] = useState(false);
  const [vynfyTestResult, setVynfyTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [emailForm, setEmailForm] = useState({
    fromAddress: "noreply@dakyx.com",
    senderName: "DakyX WhatsApp CRM",
  });

  useState(() => {
    if (data) {
      setAiForm({
        apiKey: "",
        triageModel: data.ai.triageModel ?? "claude-opus-5-5",
        draftModel: data.ai.draftModel ?? "claude-opus-5-5",
      });
      setVynfyForm({
        apiKey: "",
        senderId: data.vynfy.senderId ?? "DakyXTech",
      });
      setEmailForm({
        fromAddress: data.email.fromAddress ?? "noreply@dakyx.com",
        senderName: data.email.senderName ?? "DakyX WhatsApp CRM",
      });
    }
  });

  const saveAi = async () => {
    const body: Record<string, unknown> = {
      triageModel: aiForm.triageModel,
      draftModel: aiForm.draftModel,
    };
    if (aiForm.apiKey.trim()) body.apiKey = aiForm.apiKey.trim();
    const res = await run(() => api("/admin/settings", { method: "PUT", body: { ai: body } }), "AI settings saved!");
    if (res) {
      setAiForm((prev) => ({ ...prev, apiKey: "" }));
      void configQuery.reload();
    }
  };

  const testAi = async () => {
    setAiTestResult(null);
    try {
      const res = await run(() =>
        api<{ ok: boolean; model: string; response?: string }>("/admin/test/ai", {
          body: { apiKey: aiForm.apiKey || undefined, model: aiForm.triageModel },
        }),
      );
      if (res?.ok) {
        setAiTestResult({ ok: true, message: `Claude API Connected! Model ${res.model} responded: "${res.response}"` });
      }
    } catch (err) {
      setAiTestResult({ ok: false, message: (err as Error).message });
    }
  };

  const saveVynfy = async () => {
    const body: Record<string, unknown> = { senderId: vynfyForm.senderId };
    if (vynfyForm.apiKey.trim()) body.apiKey = vynfyForm.apiKey.trim();
    const res = await run(() => api("/admin/settings", { method: "PUT", body: { vynfy: body } }), "Vynfy SMS settings saved!");
    if (res) {
      setVynfyForm((prev) => ({ ...prev, apiKey: "" }));
      void configQuery.reload();
    }
  };

  const testVynfy = async () => {
    setVynfyTestResult(null);
    try {
      const res = await run(() =>
        api<{ ok: boolean; message: string }>("/admin/test/vynfy", {
          body: { apiKey: vynfyForm.apiKey || undefined, senderId: vynfyForm.senderId },
        }),
      );
      if (res) {
        setVynfyTestResult({ ok: res.ok, message: res.message });
      }
    } catch (err) {
      setVynfyTestResult({ ok: false, message: (err as Error).message });
    }
  };

  const saveEmail = async () => {
    const res = await run(() => api("/admin/settings", { method: "PUT", body: { email: emailForm } }), "Email settings saved!");
    if (res) void configQuery.reload();
  };

  return (
    <div className="space-y-5">
      {/* Anthropic Claude AI */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Anthropic Claude AI</h2>
            <p className="text-xs text-slate-500">Powers chat categorization, sentiment triage & reply drafting.</p>
          </div>
          <button className="btn-ghost text-xs" onClick={testAi} disabled={busy}>
            Test Claude Ping
          </button>
        </div>

        {aiTestResult && (
          <div
            className={`mt-3 rounded-xl p-3 text-xs font-medium ${
              aiTestResult.ok ? "bg-[#eef9f3] text-[#008069]" : "bg-red-50 text-red-700"
            }`}
          >
            {aiTestResult.ok ? "✅ " : "⚠️ "}
            {aiTestResult.message}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="label">Anthropic API Key (sk-ant-...)</label>
              {data?.ai.hasApiKey && (
                <span className="text-[11px] text-[#008069] font-medium">{data.ai.apiKeyMasked}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                type={showAiKey ? "text" : "password"}
                placeholder={data?.ai.hasApiKey ? "Leave blank to keep current key" : "sk-ant-..."}
                value={aiForm.apiKey}
                onChange={(e) => setAiForm({ ...aiForm, apiKey: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setShowAiKey(!showAiKey)}
              >
                {showAiKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Triage Model (Categorization & Sentiment)</label>
            <select
              className="input text-xs"
              value={aiForm.triageModel || data?.ai.triageModel || "claude-opus-5-5"}
              onChange={(e) => setAiForm({ ...aiForm, triageModel: e.target.value })}
            >
              <option value="claude-opus-5-5">Claude Opus 5.5 (Highest Accuracy)</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5 (Fast & Cost Effective)</option>
              <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
            </select>
          </div>

          <div>
            <label className="label">Draft Model (Customer Replies)</label>
            <select
              className="input text-xs"
              value={aiForm.draftModel || data?.ai.draftModel || "claude-opus-5-5"}
              onChange={(e) => setAiForm({ ...aiForm, draftModel: e.target.value })}
            >
              <option value="claude-opus-5-5">Claude Opus 5.5 (Warm Ghanaian Context)</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
              <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn-primary text-xs" onClick={saveAi} disabled={busy}>
            Save AI Settings
          </button>
        </div>
      </div>

      {/* Vynfy SMS & Voice */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Vynfy SMS & Voice OTP Gateway</h2>
            <p className="text-xs text-slate-500">Ghanaian mobile SMS verification & voice codes.</p>
          </div>
          <button className="btn-ghost text-xs" onClick={testVynfy} disabled={busy}>
            Test Vynfy Ping
          </button>
        </div>

        {vynfyTestResult && (
          <div
            className={`mt-3 rounded-xl p-3 text-xs font-medium ${
              vynfyTestResult.ok ? "bg-[#eef9f3] text-[#008069]" : "bg-red-50 text-red-700"
            }`}
          >
            {vynfyTestResult.ok ? "✅ " : "⚠️ "}
            {vynfyTestResult.message}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Vynfy API Key</label>
              {data?.vynfy.hasApiKey && (
                <span className="text-[11px] text-[#008069] font-medium">{data.vynfy.apiKeyMasked}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                type={showVynfyKey ? "text" : "password"}
                placeholder={data?.vynfy.hasApiKey ? "Leave blank to keep current key" : "Enter Vynfy Key"}
                value={vynfyForm.apiKey}
                onChange={(e) => setVynfyForm({ ...vynfyForm, apiKey: e.target.value })}
              />
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setShowVynfyKey(!showVynfyKey)}
              >
                {showVynfyKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Vynfy Approved Sender ID (Max 11 chars)</label>
            <input
              className="input text-xs"
              maxLength={11}
              placeholder="DakyXTech"
              value={vynfyForm.senderId || data?.vynfy.senderId || "DakyXTech"}
              onChange={(e) => setVynfyForm({ ...vynfyForm, senderId: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn-primary text-xs" onClick={saveVynfy} disabled={busy}>
            Save Vynfy Settings
          </button>
        </div>
      </div>

      {/* Email / SMTP Status */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800">Email & Hostinger SMTP</h2>
        <p className="text-xs text-slate-500">Sends daily morning digest and password reset emails.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">From Address</label>
            <input
              className="input text-xs"
              placeholder="noreply@dakyx.com"
              value={emailForm.fromAddress || data?.email.fromAddress || "noreply@dakyx.com"}
              onChange={(e) => setEmailForm({ ...emailForm, fromAddress: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Sender Display Name</label>
            <input
              className="input text-xs"
              placeholder="DakyX WhatsApp CRM"
              value={emailForm.senderName || data?.email.senderName || "DakyX WhatsApp CRM"}
              onChange={(e) => setEmailForm({ ...emailForm, senderName: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn-primary text-xs" onClick={saveEmail} disabled={busy}>
            Save Email Settings
          </button>
        </div>
      </div>
    </div>
  );
}
