import { useEffect, useState } from "react";
import { api } from "./api";
import type { Branding, Me, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./lib/rota";
import { RotaGrid } from "./components/RotaGrid";
import { EmployeesPanel } from "./components/EmployeesPanel";
import { SettingsPanel } from "./components/SettingsPanel";

type Tab = "rota" | "employees" | "settings";
type Theme = "light" | "dark";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("rota");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [logoVersion, setLogoVersion] = useState(() => Date.now());
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  // Apply theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Apply branding (title + brand colour)
  useEffect(() => {
    document.title = branding?.appName || "Shift Rota";
    const root = document.documentElement;
    if (branding?.primaryColor) {
      root.style.setProperty("--brand", branding.primaryColor);
      root.style.setProperty("--brand-dark", branding.primaryColor);
    }
  }, [branding]);

  async function refreshBranding() {
    const b = await api.getBranding();
    setBranding(b);
    setLogoVersion(Date.now());
  }

  async function refreshMe() {
    setLoading(true);
    try {
      const m = await api.me();
      setMe(m);
      if (m.authorized) {
        const [s, b] = await Promise.all([api.getSettings(), api.getBranding()]);
        setSettings(s);
        setBranding(b);
        setLogoVersion(Date.now());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshMe();
  }, []);

  if (loading) return <div className="spinner">Loading…</div>;

  const canEdit = !!me?.canEdit;
  const appName = branding?.appName || "Shift Rota";

  if (!me?.signedIn) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2>{appName}</h2>
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
            rota yet. Ask an admin to add you as an employee or viewer, then refresh.
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
        {branding?.hasLogo && (
          <img className="brand-logo" src={`/api/branding/logo?v=${logoVersion}`} alt={appName} />
        )}
        <h1>{appName}</h1>
        <div className="spacer" />
        <span className="user">
          {me.displayName} · {me.role ?? ""}
          {!canEdit ? " (view-only)" : ""}
        </span>
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle dark mode"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
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
          <SettingsPanel
            settings={settings}
            onSaved={setSettings}
            branding={branding}
            onBrandingChanged={refreshBranding}
          />
        )}
      </main>
    </>
  );
}
