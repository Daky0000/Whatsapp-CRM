import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, type Me } from "./api";
import AuthPage from "./pages/Auth";
import BillingPage from "./pages/Billing";
import BroadcastsPage from "./pages/Broadcasts";
import ContactsPage from "./pages/Contacts";
import DashboardPage from "./pages/Dashboard";
import InboxPage from "./pages/Inbox";
import OrdersPage from "./pages/Orders";
import AutomationPage from "./pages/Automation";
import SettingsPage from "./pages/Settings";
import { MeContext, ToastProvider } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: "◧" },
  { to: "/inbox", label: "Inbox", icon: "✉" },
  { to: "/contacts", label: "Contacts", icon: "☺" },
  { to: "/broadcasts", label: "Broadcasts", icon: "📣" },
  { to: "/orders", label: "Orders", icon: "🧾" },
  { to: "/automation", label: "AI & auto-replies", icon: "⚡" },
  { to: "/settings", label: "Settings", icon: "⚙" },
  { to: "/billing", label: "Billing", icon: "₵" },
];

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const reload = useCallback(async () => {
    try {
      setMe(await api<Me>("/auth/me"));
    } catch {
      setMe(null);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (me === undefined) return <div className="grid h-screen place-items-center text-sm text-slate-400">Loading…</div>;

  return (
    <ToastProvider>
      {me === null ? (
        <AuthPage onDone={reload} />
      ) : (
        <MeContext.Provider value={{ me, reload }}>
          <Shell me={me} onLogout={async () => (await api("/auth/logout", { body: {} }), setMe(null))}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/inbox/:id" element={<InboxPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/broadcasts" element={<BroadcastsPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/automation" element={<AutomationPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </MeContext.Provider>
      )}
    </ToastProvider>
  );
}

function Shell({ me, onLogout, children }: { me: Me; onLogout: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const trialDays = me.workspace.trialEndsAt ? Math.ceil((new Date(me.workspace.trialEndsAt).getTime() - Date.now()) / 86_400_000) : 0;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform border-r border-slate-200 bg-white transition md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">D</span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">WhatsApp CRM</div>
            <div className="text-[11px] text-slate-400">by DakyX</div>
          </div>
        </div>
        <nav className="space-y-0.5 p-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50"}`
              }
            >
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 p-4 text-xs text-slate-500">
          <div className="truncate font-medium text-slate-700">{me.workspace.name}</div>
          <div className="truncate">{me.user.email}</div>
          <button className="mt-2 text-brand-700 hover:underline" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-slate-900/30 md:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 md:hidden">
          <button className="rounded p-1.5 hover:bg-slate-100" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          <span className="text-sm font-semibold">WhatsApp CRM</span>
        </header>
        {!me.billing.active ? (
          <Banner tone="red">
            Your {me.workspace.status === "TRIALING" || me.workspace.status === "EXPIRED" ? "trial or plan" : "plan"} has ended. Your chats are safe, but sending and AI are paused.{" "}
            <Link to="/billing" className="font-semibold underline">Choose a plan</Link>
          </Banner>
        ) : me.workspace.status === "TRIALING" ? (
          <Banner tone="amber">
            Free trial of Pro: {trialDays} day{trialDays === 1 ? "" : "s"} left. <Link to="/billing" className="font-semibold underline">See plans</Link>
          </Banner>
        ) : null}
        {!me.connection && (
          <Banner tone="sky">
            Connect your WhatsApp Business number to start.{" "}
            <Link to="/settings" className="font-semibold underline">Connect WhatsApp</Link>
          </Banner>
        )}
        {/* The inbox fills the screen edge to edge; every other page scrolls inside a centred column. */}
        {location.pathname.startsWith("/inbox") ? (
          <main className="min-h-0 flex-1">{children}</main>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <main className="mx-auto w-full max-w-6xl p-4 md:p-6">{children}</main>
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "red" | "amber" | "sky"; children: React.ReactNode }) {
  const styles = { red: "bg-red-50 text-red-800 border-red-100", amber: "bg-amber-50 text-amber-900 border-amber-100", sky: "bg-sky-50 text-sky-900 border-sky-100" };
  return <div className={`border-b px-4 py-2 text-sm ${styles[tone]}`}>{children}</div>;
}
