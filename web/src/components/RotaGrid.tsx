import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { DayView, Employee, Settings } from "../types";
import { addDays, mondayOf, todayISO } from "../lib/rota";
import { dowLabel, prettyDate, SHIFT_LABEL, shiftTime } from "../lib/display";
import { DayCellDialog } from "./DayCellDialog";

interface Row {
  id: string;
  name: string;
  order: number;
}

export function RotaGrid({ settings }: { settings: Settings }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()));
  const [days, setDays] = useState<DayView[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ date: string; empId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const to = addDays(weekStart, 6);
      const [rota, emps] = await Promise.all([
        api.rota(weekStart, to),
        api.listEmployees(),
      ]);
      setDays(rota.days);
      setEmployees(emps);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  const empOrder = useMemo(() => {
    const m = new Map<string, number>();
    employees.forEach((e) => m.set(e.id, e.rotationOrder));
    return m;
  }, [employees]);

  // Build rows from everyone appearing in the week (incl. ex-employees on sealed days).
  const rows: Row[] = useMemo(() => {
    const names = new Map<string, string>();
    employees.forEach((e) => names.set(e.id, e.displayName));
    for (const d of days) {
      for (const a of d.assignments) names.set(a.employeeId, a.displayName);
    }
    const ids = new Set<string>(names.keys());
    const list: Row[] = [...ids].map((id) => ({
      id,
      name: names.get(id) || id,
      order: empOrder.has(id) ? empOrder.get(id)! : Number.MAX_SAFE_INTEGER,
    }));
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return list;
  }, [days, employees, empOrder]);

  const dayByDate = useMemo(() => {
    const m = new Map<string, DayView>();
    days.forEach((d) => m.set(d.date, d));
    return m;
  }, [days]);

  const isThisWeek = weekStart === mondayOf(todayISO());

  const dialogDay = dialog ? dayByDate.get(dialog.date) ?? null : null;

  return (
    <div className="panel">
      <div className="toolbar">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>← Prev</button>
        <button onClick={() => setWeekStart(mondayOf(todayISO()))} disabled={isThisWeek}>
          This week
        </button>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Next →</button>
        <span className="week-label">
          Week of {prettyDate(weekStart)} – {prettyDate(addDays(weekStart, 6))}
        </span>
        <div className="spacer" />
        <button onClick={load}>Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="spinner">Loading rota…</div>
      ) : days.length === 0 ? (
        <p className="muted">
          No working days configured, or no employees yet. Add employees on the Employees tab.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="rota">
            <thead>
              <tr>
                <th className="name">Employee</th>
                {days.map((d) => (
                  <th key={d.date}>
                    <span className="dow">{dowLabel(d.weekday)}</span>
                    <span className="date">{prettyDate(d.date)}</span>
                  </th>
                ))}
              </tr>
              <tr>
                <th className="name" style={{ fontWeight: 400, color: "var(--muted)" }}>
                  Coverage
                </th>
                {days.map((d) => (
                  <th key={d.date}>
                    <CoverageBadges day={d} settings={settings} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="name">{row.name}</td>
                  {days.map((d) => (
                    <Cell
                      key={d.date}
                      day={d}
                      empId={row.id}
                      settings={settings}
                      onClick={() => setDialog({ date: d.date, empId: row.id })}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="legend">
        <span><span className="swatch" style={{ background: "var(--early)" }} /> Earlies {shiftTime("early", settings)}</span>
        <span><span className="swatch" style={{ background: "var(--late)" }} /> Lates {shiftTime("late", settings)}</span>
        <span><span className="swatch" style={{ background: "var(--normal)" }} /> Normal {shiftTime("normal", settings)}</span>
        <span className="hint">Click a current/future cell to swap, change or book time off. Past weeks are locked.</span>
      </div>

      {dialog && dialogDay && (
        <DayCellDialog
          date={dialog.date}
          empId={dialog.empId}
          day={dialogDay}
          settings={settings}
          onClose={() => setDialog(null)}
          onChanged={async () => {
            await load();
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function CoverageBadges({ day, settings }: { day: DayView; settings: Settings }) {
  const v = day.validation;
  const eClass = v.earlies < 1 ? "bad" : v.earlies === settings.earliesTarget ? "ok" : "warn";
  const lClass = v.lates < 1 ? "bad" : v.lates === settings.latesTarget ? "ok" : "warn";
  return (
    <div className="coverage">
      <span className={`badge ${eClass}`}>{v.earlies}E</span>
      <span className={`badge ${lClass}`}>{v.lates}L</span>
    </div>
  );
}

function Cell({
  day,
  empId,
  settings,
  onClick,
}: {
  day: DayView;
  empId: string;
  settings: Settings;
  onClick: () => void;
}) {
  const a = day.assignments.find((x) => x.employeeId === empId);
  const isOff = !a && day.off.includes(empId);

  if (day.sealed) {
    return (
      <td className="sealed">
        {a ? (
          <div className={`cell ${a.shift}`}>
            <span className="label">{SHIFT_LABEL[a.shift]}</span>
          </div>
        ) : (
          <div className="cell empty">—</div>
        )}
      </td>
    );
  }

  if (a) {
    return (
      <td>
        <button className={`cell ${a.shift}`} onClick={onClick}>
          <span className="label">{SHIFT_LABEL[a.shift]}</span>
          <span className="time">{shiftTime(a.shift, settings)}</span>
        </button>
      </td>
    );
  }
  if (isOff) {
    return (
      <td>
        <button className="cell off" onClick={onClick}>
          Off
        </button>
      </td>
    );
  }
  return (
    <td>
      <div className="cell empty">—</div>
    </td>
  );
}
