// Core rota logic — pure functions, no I/O.
// This file is the authoritative copy. web/src/lib/rota.ts is kept identical
// (the web copy is only used for instant UI feedback; the server always re-validates).

export type Shift = "early" | "late" | "normal";

export const SHIFTS: Shift[] = ["early", "late", "normal"];

export interface ShiftWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface Settings {
  shiftTimes: Record<Shift, ShiftWindow>;
  earliesTarget: number; // default 2
  latesTarget: number; // default 1
  anchorMonday: string; // ISO yyyy-mm-dd, must be a Monday — rotation epoch
  workingDays: number[]; // ISO weekday numbers 1..7 (1=Mon). Default [1,2,3,4,5]
  sealedThrough?: string | null; // ISO date of last frozen day
}

export const DEFAULT_SETTINGS: Settings = {
  shiftTimes: {
    early: { start: "08:00", end: "16:00" },
    late: { start: "09:15", end: "17:30" },
    normal: { start: "08:45", end: "17:00" },
  },
  earliesTarget: 2,
  latesTarget: 1,
  anchorMonday: mondayOf(todayISO()),
  workingDays: [1, 2, 3, 4, 5],
  sealedThrough: null,
};

export interface Employee {
  id: string;
  displayName: string;
  email: string; // lowercased
  rotationOrder: number;
  active: boolean;
}

export interface DayAssignment {
  employeeId: string;
  displayName: string;
  shift: Shift;
  off?: boolean; // present only in summaries that include people off
}

export interface DayValidation {
  ok: boolean;
  earlies: number;
  lates: number;
  normals: number;
  onTarget: boolean; // matches earliesTarget/latesTarget exactly
  reasons: string[]; // why not ok / warnings
}

// ----------------------------------------------------------------------------
// Date helpers (all in UTC to avoid timezone drift on ISO yyyy-mm-dd values)
// ----------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISO(iso: string): Date {
  // Treat as midnight UTC.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** ISO weekday 1..7 (1 = Monday, 7 = Sunday). */
export function isoWeekday(iso: string): number {
  const day = parseISO(iso).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

/** Monday (ISO date) of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const d = parseISO(iso);
  const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (wd - 1));
  return toISO(d);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** Whole weeks between two Mondays (can be negative). */
export function weekIndex(mondayISO: string, anchorMondayISO: string): number {
  const diff = parseISO(mondayISO).getTime() - parseISO(anchorMondayISO).getTime();
  return Math.round(diff / (7 * MS_PER_DAY));
}

export function isWorkingDay(iso: string, settings: Settings): boolean {
  return settings.workingDays.includes(isoWeekday(iso));
}

/** Working-day ISO dates within a week, given any date in that week. */
export function workingDaysOfWeek(anyDateInWeek: string, settings: Settings): string[] {
  const monday = mondayOf(anyDateInWeek);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(monday, i);
    if (isWorkingDay(iso, settings)) out.push(iso);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Rota computation
// ----------------------------------------------------------------------------

/**
 * The shift "slots" for a week given headcount `n`.
 * Targets default to 2 earlies + 1 late, rest normal, and gracefully degrade
 * for tiny teams while keeping at least one early and one late when possible.
 *
 * The slots are arranged by INTERLEAVING the "special" shifts (earlies/lates)
 * with normals, e.g. for 6 people: [early, normal, early, normal, late, normal].
 * Because each person advances one slot per week (a cyclic shift), this makes a
 * special week always be followed by a normal week — i.e. if you're on Earlies
 * one week you're on Normals the next. Counts per week are unchanged.
 */
export function buildWeekSlots(n: number, earliesTarget = 2, latesTarget = 1): Shift[] {
  if (n <= 0) return [];
  const e = Math.max(1, earliesTarget);
  const l = Math.max(1, latesTarget);

  let ne = Math.min(e, n);
  let remaining = n - ne;
  let nl = Math.min(l, remaining);
  remaining -= nl;

  // If everyone landed on earlies but we have room for a late, steal one
  // so coverage (>=1 early, >=1 late) holds whenever n >= 2.
  if (nl === 0 && n >= 2) {
    ne -= 1;
    nl = 1;
  }
  const nn = remaining;

  const specials: Shift[] = [
    ...Array<Shift>(ne).fill("early"),
    ...Array<Shift>(nl).fill("late"),
  ];
  const normals: Shift[] = Array<Shift>(nn).fill("normal");

  // Interleave: special, normal, special, normal, ... so specials are spaced
  // out by normal weeks as much as the headcount allows.
  const slots: Shift[] = [];
  let i = 0;
  let j = 0;
  while (i < specials.length || j < normals.length) {
    if (i < specials.length) slots.push(specials[i++]);
    if (j < normals.length) slots.push(normals[j++]);
  }
  return slots;
}

function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

export function activeSorted(employees: Employee[]): Employee[] {
  return employees
    .filter((e) => e.active)
    .slice()
    .sort((a, b) =>
      a.rotationOrder - b.rotationOrder || a.id.localeCompare(b.id)
    );
}

/**
 * Each person's default shift for the WHOLE week, derived from the rotating
 * cyclic shift of the week's slot multiset. Returns a map employeeId -> Shift.
 */
export function baseWeekShifts(
  employees: Employee[],
  wIndex: number,
  settings: Settings
): Map<string, Shift> {
  const sorted = activeSorted(employees);
  const slots = buildWeekSlots(sorted.length, settings.earliesTarget, settings.latesTarget);
  const map = new Map<string, Shift>();
  sorted.forEach((emp, i) => {
    map.set(emp.id, slots[mod(i + wIndex, slots.length)]);
  });
  return map;
}

export interface ResolveInput {
  date: string; // ISO
  employees: Employee[];
  settings: Settings;
  overrides: Record<string, Shift>; // employeeId -> shift (for this date)
  off: string[]; // employeeIds off this date
}

/**
 * Resolve who is working which shift on a single day, applying day-off and
 * day-overrides on top of the weekly base pattern.
 */
export function resolveDay(input: ResolveInput): DayAssignment[] {
  const { date, employees, settings, overrides, off } = input;
  const wIndex = weekIndex(mondayOf(date), settings.anchorMonday);
  const base = baseWeekShifts(employees, wIndex, settings);
  const offSet = new Set(off);
  const sorted = activeSorted(employees);

  const out: DayAssignment[] = [];
  for (const emp of sorted) {
    if (offSet.has(emp.id)) continue;
    const shift = overrides[emp.id] ?? base.get(emp.id) ?? "normal";
    out.push({ employeeId: emp.id, displayName: emp.displayName, shift });
  }
  return out;
}

export function validateDay(assignments: DayAssignment[], settings: Settings): DayValidation {
  let earlies = 0;
  let lates = 0;
  let normals = 0;
  for (const a of assignments) {
    if (a.off) continue;
    if (a.shift === "early") earlies++;
    else if (a.shift === "late") lates++;
    else normals++;
  }
  const reasons: string[] = [];
  if (earlies < 1) reasons.push("No one on Earlies (need at least 1).");
  if (lates < 1) reasons.push("No one on Lates (need at least 1).");
  const ok = earlies >= 1 && lates >= 1;
  const onTarget = earlies === settings.earliesTarget && lates === settings.latesTarget;
  if (ok && !onTarget) {
    reasons.push(
      `Off target: ${earlies} early / ${lates} late (target ${settings.earliesTarget}/${settings.latesTarget}).`
    );
  }
  return { ok, earlies, lates, normals, onTarget, reasons };
}
