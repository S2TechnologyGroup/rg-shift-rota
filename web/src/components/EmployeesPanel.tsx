import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import type { Employee } from "../types";

export function EmployeesPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setEmployees(await api.listEmployees());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...employees].sort((a, b) => a.rotationOrder - b.rotationOrder);

  async function move(idx: number, dir: -1 | 1) {
    const a = sorted[idx];
    const b = sorted[idx + dir];
    if (!a || !b) return;
    await run(async () => {
      await api.updateEmployee({ id: a.id, rotationOrder: b.rotationOrder });
      await api.updateEmployee({ id: b.id, rotationOrder: a.rotationOrder });
    });
  }

  async function add() {
    if (!name.trim() || !email.trim()) {
      setError("Enter a name and email.");
      return;
    }
    await run(async () => {
      await api.createEmployee(name.trim(), email.trim());
      setName("");
      setEmail("");
    });
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Employees</h2>
      <p className="hint">
        Rotation order sets who starts on which shift; the pattern cycles down the list each week.
        The rota auto-adjusts to the number of <em>active</em> employees.
      </p>
      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="spinner">Loading…</div>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th className="num">Order</th>
              <th>Name</th>
              <th>Email</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => (
              <tr key={e.id} style={{ opacity: e.active ? 1 : 0.55 }}>
                <td className="num">
                  <button disabled={busy || i === 0} onClick={() => move(i, -1)} title="Move up">
                    ↑
                  </button>{" "}
                  <button
                    disabled={busy || i === sorted.length - 1}
                    onClick={() => move(i, 1)}
                    title="Move down"
                  >
                    ↓
                  </button>
                </td>
                <td>{e.displayName}</td>
                <td className="muted">{e.email}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={e.active}
                    disabled={busy}
                    onChange={() => run(() => api.updateEmployee({ id: e.id, active: !e.active }))}
                  />
                </td>
                <td>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove ${e.displayName}? Past rota history is preserved.`))
                        run(() => api.deleteEmployee(e.id));
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No employees yet — add the first one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div className="inline-form">
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
        </div>
        <div className="field">
          <label>Email (M365)</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@company.com"
          />
        </div>
        <button className="primary" disabled={busy} onClick={add}>
          Add employee
        </button>
      </div>
    </div>
  );
}
