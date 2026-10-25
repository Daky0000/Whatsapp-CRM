import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, type Me } from "./api";
import AdminPage from "./pages/Admin";
import AnalyticsPage from "./pages/Analytics";
import AuthPage, { ResetFromLink } from "./pages/Auth";
import BillingPage from "./pages/Billing";
import BroadcastsPage from "./pages/Broadcasts";
import ContactsPage from "./pages/Contacts";
import DashboardPage from "./pages/Dashboard";
import InboxPage from "./pages/Inbox";
import OrdersPage from "./pages/Orders";
import AutomationPage from "./pages/Automation";
import SettingsPage from "./pages/Settings";
import { MeContext, ToastProvider } from "./ui";

const USER_NAV = [
  { to: "/", label: "Dashboard", icon: "◧" },
  { to: "/inbox", label: "Inbox", icon: "✉" },
  { to: "/contacts", label: "Contacts", icon: "☺" },
  { to: "/broadcasts", label: "Broadcasts", icon: "📣" },
  { to: "/orders", label: "Orders", icon: "🧾" },
  { to: "/analytics", label: "Analytics", icon: "📈" },
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

  // Where a seller's customer lands after paying a link. Public, and claims nothing it can't know.
  if (window.location.pathname === "/paid") return <PaidPage />;
  if (window.location.pathname === "/reset") return <ToastProvider><ResetFromLink /></ToastProvider>;
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
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/automation" element={<AutomationPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/billing" element={<BillingPage />} />
              {me.user.platformAdmin && <Route path="/admin" element={<AdminPage />} />}
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
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [location.pathname]);
  const trialDays = me.workspace.trialEndsAt ? Math.ceil((new Date(me.workspace.trialEndsAt).getTime() - Date.now()) / 86_400_000) : 0;
  const isAdminRoute = location.pathname.startsWith("/admin");

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f0f2f5]">
      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-200/90 bg-white transition md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#008069] text-sm font-bold text-white shadow-xs">
              D
            </span>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight text-slate-900">WhatsApp CRM</div>
              <div className="text-[11px] font-medium text-[#008069]">by DakyX</div>
            </div>
          </div>
          {me.user.platformAdmin && (
            <span className="rounded-full bg-[#dcf8c6] px-2 py-0.5 text-[10px] font-semibold text-[#075e54]">
              Staff
            </span>
          )}
        </div>

        {/* Admin / User View Switcher Segmented Control */}
        {me.user.platformAdmin && (
          <div className="p-3 border-b border-slate-100 bg-slate-50/60">
            <div className="flex rounded-xl bg-slate-200/70 p-1 text-xs font-semibold shadow-2xs">
              <button
                onClick={() => navigate("/")}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition ${
                  !isAdminRoute
                    ? "bg-white text-[#075e54] shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>👤</span>
                <span>User CRM</span>
              </button>
              <button
                onClick={() => navigate("/admin")}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition ${
                  isAdminRoute
                    ? "bg-[#008069] text-white shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>🛡</span>
                <span>Admin</span>
              </button>
            </div>
          </div>
        )}

        {/* Navigation List */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {USER_NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                  isActive && !isAdminRoute
                    ? "bg-[#dcf8c6] font-semibold text-[#075e54]"
                    : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900"
                }`
              }
            >
              <span className="w-5 text-center text-base">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}

          {me.user.platformAdmin && (
            <div className="pt-2">
              <div className="px-3 pb-1 text-[10px] font-bold tracking-wider uppercase text-slate-400">
                Platform Admin
              </div>
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                    isActive
                      ? "bg-[#008069] font-semibold text-white shadow-xs"
                      : "text-slate-700 bg-slate-100/80 hover:bg-slate-200"
                  }`
                }
              >
                <span className="w-5 text-center">🛡</span>
                <span className="font-medium">Admin Console</span>
              </NavLink>
            </div>
          )}
        </nav>

        {/* User Workspace Info & Logout */}
        <div className="border-t border-slate-100 p-4 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span className="truncate font-semibold text-slate-800">{me.workspace.name}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {me.workspace.plan}
            </span>
          </div>
          <div className="truncate text-slate-500">{me.user.email}</div>
          <button className="mt-2 text-[#008069] font-medium hover:underline" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Backdrop */}
      {open && <div className="fixed inset-0 z-20 bg-slate-900/40 md:hidden" onClick={() => setOpen(false)} />}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile Header */}
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
          <div className="flex items-center gap-3">
            <button className="rounded p-1.5 hover:bg-slate-100" onClick={() => setOpen(true)} aria-label="Menu">
              ☰
            </button>
            <span className="text-sm font-bold text-slate-900">WhatsApp CRM</span>
          </div>
          {me.user.platformAdmin && (
            <button
              onClick={() => navigate(isAdminRoute ? "/" : "/admin")}
              className="rounded-lg bg-[#008069] px-2.5 py-1 text-xs font-semibold text-white"
            >
              {isAdminRoute ? "User View" : "Admin"}
            </button>
          )}
        </header>

        {/* Desktop Admin Quick Switch Banner when in User view */}
        {me.user.platformAdmin && !isAdminRoute && (
          <div className="hidden md:flex items-center justify-between border-b border-[#00a884]/20 bg-[#eef9f3] px-6 py-2 text-xs text-[#075e54]">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-[#25d366]" />
              <span>Viewing Workspace: <b>{me.workspace.name}</b> (You have Superadmin rights)</span>
            </div>
            <button
              onClick={() => navigate("/admin")}
              className="flex items-center gap-1.5 rounded-lg bg-[#008069] px-3 py-1 font-semibold text-white shadow-2xs hover:bg-[#006e5a]"
            >
              <span>🛡 Switch to Admin Console</span>
            </button>
          </div>
        )}

        {/* Billing & Trial Banners */}
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
        {!me.connection && !isAdminRoute && (
          <Banner tone="sky">
            Connect your WhatsApp Business number to start.{" "}
            <Link to="/settings" className="font-semibold underline">Connect WhatsApp</Link>
          </Banner>
        )}

        {/* Page Content */}
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
  const styles = {
    red: "bg-red-50 text-red-800 border-red-100",
    amber: "bg-amber-50 text-amber-900 border-amber-100",
    sky: "bg-[#eef9f3] text-[#075e54] border-[#d4f4e2]",
  };
  return <div className={`border-b px-4 py-2 text-xs font-medium ${styles[tone]}`}>{children}</div>;
}

function PaidPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[#f0f2f5] p-6">
      <div className="card max-w-sm p-8 text-center shadow-md">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#dcf8c6] text-2xl text-[#075e54]">
          ✓
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">Payment Confirmed</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your payment was processed successfully. The merchant has been notified and your order is confirmed. You can close this window and return to WhatsApp.
        </p>
      </div>
    </div>
  );
}
