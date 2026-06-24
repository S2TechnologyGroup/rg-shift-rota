import { useMemo, useState } from "react";
import { ApiError, api } from "../api";
import type { DayAssignment, DayView, Settings, Shift } from "../types";
import { SHIFTS, validateDay } from "../lib/rota";
import { dowLabel, prettyDate, SHIFT_LABEL, shiftTime } from "../lib/display";

interface Props {
  date: string;
  empId: string;
  day: DayView;
  settings: Settings;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

export function DayCellDialog({ date, empId, day, settings, onClose, onChanged }: Props) {
  const me = day.assignments.find((a) => a.employeeId === empId);
  const name = me?.displayName ?? "Employee";
  const others = day.assignments.filter((a) => a.employeeId !== empId);

  const [targetShift, setTargetShift] = useState<Shift>(me?.shift ?? "normal");
  const [swapWith, setSwapWith] = useState<string>(others[0]?.employeeId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; reasons?: string[] } | null>(null);

  // Client-side preview of the resulting coverage for the chosen shift change.
  const preview = useMemo(() => {
    if (!me) return null;
    const next: DayAssignment[] = day.assignments.map((a) =>
      a.employeeId === empId ? { ...a, shift: targetShift } : a
    );
    return validateDay(next, settings);
  }, [day.assignments, empId, targetShift, settings, me]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError) setError({ msg: e.message, reasons: e.reasons });
      else setError({ msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{name}</h3>
        <div className="sub">
          {dowLabel(day.weekday)} {prettyDate(date)}
        </div>

        {error && (
          <div className="error">
            {error.msg}
            {error.reasons && error.reasons.length > 0 && (
              <ul>
                {error.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!me ? (
          <>
            <p className="muted">This person is booked off on this day.</p>
            <div className="actions">
              <button onClick={onClose}>Close</button>
              <button
                disabled={busy}
                onClick={() => run(() => api.timeOffWeek(date, empId, false))}
              >
                Bring back (whole week)
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => run(() => api.timeOffDay(date, empId, false))}
              >
                Bring back this day
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <span>Current:</span>
              <span className={`shift-chip ${me.shift}`}>
                {SHIFT_LABEL[me.shift]} · {shiftTime(me.shift, settings)}
              </span>
            </div>

            <div className="row">
              <strong>Change shift</strong>
            </div>
            <div className="row">
              {SHIFTS.map((s) => (
                <button
                  key={s}
                  className={s === targetShift ? "primary" : ""}
                  onClick={() => setTargetShift(s)}
                >
                  {SHIFT_LABEL[s]}
                </button>
              ))}
            </div>
            {preview && (
              <div className="preview">
                Resulting coverage: {preview.earlies} early / {preview.lates} late{" "}
                {preview.ok ? "✓ ok" : "— would be blocked"}
              </div>
            )}
            <div className="actions">
              <button
                disabled={busy || targetShift === me.shift}
                className="primary"
                onClick={() => run(() => api.setOverride(date, empId, targetShift))}
              >
                Apply shift
              </button>
              <button
                disabled={busy}
                onClick={() => run(() => api.clearOverride(date, empId))}
                title="Revert this day back to the rotating pattern"
              >
                Reset to pattern
              </button>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "14px 0" }} />

            <div className="row">
              <strong>Swap for the day with</strong>
            </div>
            <div className="row">
              <select
                value={swapWith}
                onChange={(e) => setSwapWith(e.target.value)}
                disabled={others.length === 0}
              >
                {others.map((o) => (
                  <option key={o.employeeId} value={o.employeeId}>
                    {o.displayName} ({SHIFT_LABEL[o.shift]})
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !swapWith}
                onClick={() => run(() => api.swap(date, empId, swapWith))}
              >
                Swap
              </button>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "14px 0" }} />

            <div className="actions">
              <button onClick={onClose}>Close</button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => run(() => api.timeOffWeek(date, empId, true))}
                title="Book this person off for every working day of this week"
              >
                Off whole week
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => run(() => api.timeOffDay(date, empId, true))}
              >
                Book day off
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
