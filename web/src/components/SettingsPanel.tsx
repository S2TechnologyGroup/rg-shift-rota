import { useState, type ChangeEvent } from "react";
import { ApiError, api } from "../api";
import type { Branding, Settings, Shift } from "../types";
import { SHIFT_LABEL } from "../lib/display";

const SHIFT_ORDER: Shift[] = ["early", "late", "normal"];
const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

export function SettingsPanel({
  settings,
  onSaved,
  branding,
  onBrandingChanged,
}: {
  settings: Settings;
  onSaved: (s: Settings) => void;
  branding: Branding | null;
  onBrandingChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Settings>(structuredClone(settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Branding state
  const [appName, setAppName] = useState(branding?.appName ?? "Shift Rota");
  const [color, setColor] = useState(branding?.primaryColor ?? "#2f6fed");
  const [bBusy, setBBusy] = useState(false);
  const [bError, setBError] = useState<string | null>(null);
  const [logoV, setLogoV] = useState(Date.now());

  async function runBranding(fn: () => Promise<unknown>) {
    setBBusy(true);
    setBError(null);
    try {
      await fn();
      await onBrandingChanged();
      setLogoV(Date.now());
    } catch (e) {
      setBError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBBusy(false);
    }
  }

  function onLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => runBranding(() => api.uploadLogo(reader.result as string));
    reader.onerror = () => setBError("Couldn't read that file.");
    reader.readAsDataURL(file);
  }

  function setTime(shift: Shift, key: "start" | "end", value: string) {
    setDraft((d) => ({
      ...d,
      shiftTimes: { ...d.shiftTimes, [shift]: { ...d.shiftTimes[shift], [key]: value } },
    }));
    setSaved(false);
  }

  function toggleDay(n: number) {
    setDraft((d) => {
      const has = d.workingDays.includes(n);
      return {
        ...d,
        workingDays: has ? d.workingDays.filter((x) => x !== n) : [...d.workingDays, n].sort(),
      };
    });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveSettings({
        shiftTimes: draft.shiftTimes,
        earliesTarget: draft.earliesTarget,
        latesTarget: draft.latesTarget,
        anchorMonday: draft.anchorMonday,
        workingDays: draft.workingDays,
      });
      onSaved(result);
      setDraft(structuredClone(result));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Settings</h2>

      <h3>Branding</h3>
      <p className="hint">
        Your logo and name are stored securely in Azure — never in source control. SVG or PNG works
        best (max 2 MB).
      </p>
      {bError && <div className="error">{bError}</div>}
      <div className="inline-form" style={{ marginTop: 0, alignItems: "center" }}>
        {branding?.hasLogo ? (
          <img className="logo-preview" src={`/api/branding/logo?v=${logoV}`} alt="Current logo" />
        ) : (
          <span className="muted">No logo set</span>
        )}
        <label className="field">
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Upload logo</span>
          <input type="file" accept="image/*" disabled={bBusy} onChange={onLogoFile} />
        </label>
        {branding?.hasLogo && (
          <button
            className="danger"
            disabled={bBusy}
            onClick={() => runBranding(() => api.deleteLogo())}
          >
            Remove logo
          </button>
        )}
      </div>
      <div className="inline-form">
        <div className="field">
          <label>App name</label>
          <input value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={60} />
        </div>
        <div className="field">
          <label>Primary colour</label>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <button
          className="primary"
          disabled={bBusy}
          onClick={() => runBranding(() => api.saveBranding({ appName, primaryColor: color }))}
        >
          Save branding
        </button>
      </div>

      <h3 style={{ marginTop: 24 }}>Shift times</h3>
      {error && <div className="error">{error}</div>}
      <table className="list" style={{ maxWidth: 440 }}>
        <thead>
          <tr>
            <th>Shift</th>
            <th>Start</th>
            <th>End</th>
          </tr>
        </thead>
        <tbody>
          {SHIFT_ORDER.map((s) => (
            <tr key={s}>
              <td>{SHIFT_LABEL[s]}</td>
              <td>
                <input
                  type="time"
                  value={draft.shiftTimes[s].start}
                  onChange={(e) => setTime(s, "start", e.target.value)}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={draft.shiftTimes[s].end}
                  onChange={(e) => setTime(s, "end", e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Weekly targets</h3>
      <div className="inline-form" style={{ marginTop: 0 }}>
        <div className="field">
          <label>People on Earlies</label>
          <input
            type="number"
            min={1}
            value={draft.earliesTarget}
            onChange={(e) => {
              setDraft((d) => ({ ...d, earliesTarget: Number(e.target.value) }));
              setSaved(false);
            }}
          />
        </div>
        <div className="field">
          <label>People on Lates</label>
          <input
            type="number"
            min={1}
            value={draft.latesTarget}
            onChange={(e) => {
              setDraft((d) => ({ ...d, latesTarget: Number(e.target.value) }));
              setSaved(false);
            }}
          />
        </div>
      </div>
      <p className="hint">Everyone else defaults to Normal. Minimum 1 Early and 1 Late is always enforced.</p>

      <h3 style={{ marginTop: 24 }}>Working days</h3>
      <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {DAYS.map((d) => (
          <label key={d.n} style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={draft.workingDays.includes(d.n)}
              onChange={() => toggleDay(d.n)}
            />
            {d.label}
          </label>
        ))}
      </div>

      <h3 style={{ marginTop: 24 }}>Rotation start (anchor)</h3>
      <div className="field" style={{ maxWidth: 220 }}>
        <label>Any date in the starting week (snaps to Monday)</label>
        <input
          type="date"
          value={draft.anchorMonday}
          onChange={(e) => {
            setDraft((d) => ({ ...d, anchorMonday: e.target.value }));
            setSaved(false);
          }}
        />
      </div>
      <p className="hint">
        This is the rota's week-zero. Changing it shifts who is on which shift going forward; sealed
        past days are unaffected.
      </p>

      <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center" }}>
        <button className="primary" disabled={busy} onClick={save}>
          Save settings
        </button>
        {saved && <span style={{ color: "var(--ok)" }}>Saved ✓</span>}
      </div>
    </div>
  );
}
