import { useEffect, useState } from "react";
import { api } from "./api";
import type { Me, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./lib/rota";
import { RotaGrid } from "./components/RotaGrid";
import { EmployeesPanel } from "./components/EmployeesPanel";
import { SettingsPanel } from "./components/SettingsPanel";

type Tab = "rota" | "employees" | "settings";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("rota");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  async function refreshMe() {
    setLoading(true);
    try {
      const m = await api.me();
      setMe(m);
      if (m.authorized) setSettings(await api.getSettings());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshMe();
  }, []);

  if (loading) return <div className="spinner">Loading…</div>;

  const canEdit = !!me?.canEdit;

  if (!me?.signedIn) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2>Shift Rota</h2>
          <p className="muted">Sign in with your Microsoft 365 work account to continue.</p>
          <a href="/.auth/login/aad?post_login_redirect_uri=/">
            <button className="primary" style={{ width: "100%" }}>
              Sign in with Microsoft
            </button>
          </a>
        </div>
      </div>
    );
  }

  if (!me.authorized) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2>Almost there</h2>
          <p className="muted">
            You're signed in as <strong>{me.email}</strong>, but your account isn't set up on the
            rota yet. Ask an admin to add you as an employee, then refresh.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <button onClick={refreshMe}>Refresh</button>
            <a href="/.auth/logout?post_logout_redirect_uri=/">
              <button>Sign out</button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="app-header">
        <h1>🗓️ Shift Rota</h1>
        <div className="spacer" />
        <span className="user">
          {me.displayName} · {me.role ?? ""}
          {!canEdit ? " (view-only)" : ""}
        </span>
        <a href="/.auth/logout?post_logout_redirect_uri=/">
          <button>Sign out</button>
        </a>
      </header>

      <nav className="tabs">
        <button className={tab === "rota" ? "active" : ""} onClick={() => setTab("rota")}>
          Rota
        </button>
        {canEdit && (
          <>
            <button
              className={tab === "employees" ? "active" : ""}
              onClick={() => setTab("employees")}
            >
              People
            </button>
            <button
              className={tab === "settings" ? "active" : ""}
              onClick={() => setTab("settings")}
            >
              Settings
            </button>
          </>
        )}
      </nav>

      <main className="container">
        {tab === "rota" && <RotaGrid settings={settings} canEdit={canEdit} />}
        {canEdit && tab === "employees" && <EmployeesPanel />}
        {canEdit && tab === "settings" && (
          <SettingsPanel settings={settings} onSaved={setSettings} />
        )}
      </main>
    </>
  );
}
