import {
  addDays,
  isWorkingDay,
  parseISO,
  resolveDay,
  todayISO,
  validateDay,
  type DayAssignment,
  type DayValidation,
  type Employee,
  type Settings,
  type Shift,
} from "./rota";
import { conflict, HttpError } from "./http";
import {
  clearOff,
  clearOverride,
  getOffRange,
  getOverridesRange,
  getRecordsRange,
  getSettings,
  listEmployees,
  saveSettings,
  setOff,
  setOverride,
  writeDayRecord,
} from "./store";

const MAX_SEAL_DAYS = 400; // safety cap per call

export interface DayView {
  date: string;
  weekday: number;
  sealed: boolean;
  assignments: DayAssignment[];
  off: string[]; // employeeIds off this day (current/future only)
  validation: DayValidation;
}

function lastCompletedDay(): string {
  return addDays(todayISO(), -1);
}

/**
 * Freeze every working day from `sealedThrough` up to `target` (inclusive)
 * into immutable DayRecords, capturing names as they are now. Past days can
 * then never be altered by later employee/settings changes.
 */
export async function ensureSealedThrough(target: string): Promise<Settings> {
  let settings = await getSettings();
  const start = settings.sealedThrough
    ? addDays(settings.sealedThrough, 1)
    : settings.anchorMonday;

  if (parseISO(target).getTime() < parseISO(start).getTime()) return settings;

  const employees = await listEmployees();
  const overrides = await getOverridesRange(start, target);
  const off = await getOffRange(start, target);

  let cursor = start;
  let lastSealed = settings.sealedThrough || null;
  let guard = 0;

  while (parseISO(cursor).getTime() <= parseISO(target).getTime()) {
    if (++guard > MAX_SEAL_DAYS) break;
    if (isWorkingDay(cursor, settings)) {
      const day = resolveDay({
        date: cursor,
        employees,
        settings,
        overrides: overrides[cursor] || {},
        off: off[cursor] || [],
      });
      for (const a of day) await writeDayRecord(cursor, a);
    }
    lastSealed = cursor;
    cursor = addDays(cursor, 1);
  }

  if (lastSealed && lastSealed !== settings.sealedThrough) {
    settings = { ...settings, sealedThrough: lastSealed };
    await saveSettings(settings);
  }
  return settings;
}

/** Advance sealing as days pass; call before reads and before mutations. */
export async function autoSeal(): Promise<Settings> {
  return ensureSealedThrough(lastCompletedDay());
}

function isSealed(date: string, settings: Settings): boolean {
  return !!settings.sealedThrough &&
    parseISO(date).getTime() <= parseISO(settings.sealedThrough).getTime();
}

// --------------------------------------------------------------- Read: rota

export async function getRota(from: string, to: string): Promise<DayView[]> {
  const settings = await autoSeal();
  const employees = await listEmployees();
  const overrides = await getOverridesRange(from, to);
  const off = await getOffRange(from, to);
  const records = await getRecordsRange(from, to);

  const out: DayView[] = [];
  let cursor = from;
  while (parseISO(cursor).getTime() <= parseISO(to).getTime()) {
    if (isWorkingDay(cursor, settings)) {
      const sealed = isSealed(cursor, settings);
      const assignments =
        sealed && records[cursor]?.length
          ? records[cursor]
          : resolveDay({
              date: cursor,
              employees,
              settings,
              overrides: overrides[cursor] || {},
              off: off[cursor] || [],
            });
      out.push({
        date: cursor,
        weekday: parseISO(cursor).getUTCDay() === 0 ? 7 : parseISO(cursor).getUTCDay(),
        sealed,
        assignments,
        off: sealed ? [] : off[cursor] || [],
        validation: validateDay(assignments, settings),
      });
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

// --------------------------------------------------------------- Mutations

async function loadDay(date: string) {
  const settings = await autoSeal();
  if (isSealed(date, settings)) {
    throw new HttpError(409, {
      error: "That day is in the past and can no longer be edited.",
    });
  }
  if (!isWorkingDay(date, settings)) {
    throw new HttpError(400, { error: "That date is not a working day." });
  }
  const employees = await listEmployees();
  const overrides = (await getOverridesRange(date, date))[date] || {};
  const off = (await getOffRange(date, date))[date] || [];
  return { settings, employees, overrides, off };
}

function validateOrThrow(
  date: string,
  employees: Employee[],
  settings: Settings,
  overrides: Record<string, Shift>,
  off: string[]
): DayView {
  const assignments = resolveDay({ date, employees, settings, overrides, off });
  const validation = validateDay(assignments, settings);
  if (!validation.ok) conflict(validation.reasons);
  return {
    date,
    weekday: parseISO(date).getUTCDay() === 0 ? 7 : parseISO(date).getUTCDay(),
    sealed: false,
    assignments,
    off,
    validation,
  };
}

/** Set or clear a single employee's shift override for one day. */
export async function setDayOverride(
  date: string,
  employeeId: string,
  shift: Shift | null
): Promise<DayView> {
  const { settings, employees, overrides, off } = await loadDay(date);
  const next = { ...overrides };
  if (shift) next[employeeId] = shift;
  else delete next[employeeId];

  const view = validateOrThrow(date, employees, settings, next, off);
  if (shift) await setOverride(date, employeeId, shift);
  else await clearOverride(date, employeeId);
  return view;
}

/** Swap two employees' shifts for a single day (atomic + validated). */
export async function swapDay(
  date: string,
  aId: string,
  bId: string
): Promise<DayView> {
  if (aId === bId) throw new HttpError(400, { error: "Pick two different people." });
  const { settings, employees, overrides, off } = await loadDay(date);

  const current = resolveDay({ date, employees, settings, overrides, off });
  const a = current.find((x) => x.employeeId === aId);
  const b = current.find((x) => x.employeeId === bId);
  if (!a || !b) {
    throw new HttpError(400, { error: "Both people must be working that day to swap." });
  }

  const next = { ...overrides, [aId]: b.shift, [bId]: a.shift };
  const view = validateOrThrow(date, employees, settings, next, off);
  await setOverride(date, aId, b.shift);
  await setOverride(date, bId, a.shift);
  return view;
}

/** Mark or unmark a single day off for an employee. */
export async function setDayOff(
  date: string,
  employeeId: string,
  isOff: boolean
): Promise<DayView> {
  const { settings, employees, overrides, off } = await loadDay(date);
  const next = isOff
    ? Array.from(new Set([...off, employeeId]))
    : off.filter((id) => id !== employeeId);

  const view = validateOrThrow(date, employees, settings, overrides, next);
  if (isOff) await setOff(date, employeeId);
  else await clearOff(date, employeeId);
  return view;
}

/** Mark/unmark a whole working week off for an employee (all-or-nothing). */
export async function setWeekOff(
  weekDates: string[],
  employeeId: string,
  isOff: boolean
): Promise<DayView[]> {
  const views: DayView[] = [];
  // Validate every day first; only persist if all pass.
  const plans: { date: string; next: string[] }[] = [];
  for (const date of weekDates) {
    const { settings, employees, overrides, off } = await loadDay(date);
    const next = isOff
      ? Array.from(new Set([...off, employeeId]))
      : off.filter((id) => id !== employeeId);
    views.push(validateOrThrow(date, employees, settings, overrides, next));
    plans.push({ date, next });
  }
  for (const date of weekDates) {
    if (isOff) await setOff(date, employeeId);
    else await clearOff(date, employeeId);
  }
  return views;
}

/** Seal up to yesterday before any change that could rewrite history. */
export async function sealBeforeMutation(): Promise<void> {
  await autoSeal();
}
