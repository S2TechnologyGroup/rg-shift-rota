// Core rota logic — pure functions, no I/O.
// IDENTICAL to api/src/lib/rota.ts. The server is authoritative; this copy only
// powers instant UI feedback (e.g. previewing coverage before submitting).

export type Shift = "early" | "late" | "normal";

export const SHIFTS: Shift[] = ["early", "late", "normal"];

export interface ShiftWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface Settings {
  shiftTimes: Record<Shift, ShiftWindow>;
  earliesTarget: number;
  latesTarget: number;
  anchorMonday: string;
  workingDays: number[];
  sealedThrough?: string | null;
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
  email: string;
  rotationOrder: number;
  active: boolean;
}

export interface DayAssignment {
  employeeId: string;
  displayName: string;
  shift: Shift;
  off?: boolean;
}

export interface DayValidation {
  ok: boolean;
  earlies: number;
  lates: number;
  normals: number;
  onTarget: boolean;
  reasons: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoWeekday(iso: string): number {
  const day = parseISO(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

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

export function weekIndex(mondayISO: string, anchorMondayISO: string): number {
  const diff = parseISO(mondayISO).getTime() - parseISO(anchorMondayISO).getTime();
  return Math.round(diff / (7 * MS_PER_DAY));
}

export function isWorkingDay(iso: string, settings: Settings): boolean {
  return settings.workingDays.includes(isoWeekday(iso));
}

export function workingDaysOfWeek(anyDateInWeek: string, settings: Settings): string[] {
  const monday = mondayOf(anyDateInWeek);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(monday, i);
    if (isWorkingDay(iso, settings)) out.push(iso);
  }
  return out;
}

export function buildWeekSlots(n: number, earliesTarget = 2, latesTarget = 1): Shift[] {
  if (n <= 0) return [];
  const e = Math.max(1, earliesTarget);
  const l = Math.max(1, latesTarget);

  let ne = Math.min(e, n);
  let remaining = n - ne;
  let nl = Math.min(l, remaining);
  remaining -= nl;

  if (nl === 0 && n >= 2) {
    ne -= 1;
    nl = 1;
  }
  const nn = remaining;

  return [
    ...Array<Shift>(ne).fill("early"),
    ...Array<Shift>(nl).fill("late"),
    ...Array<Shift>(nn).fill("normal"),
  ];
}

function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

export function activeSorted(employees: Employee[]): Employee[] {
  return employees
    .filter((e) => e.active)
    .slice()
    .sort((a, b) => a.rotationOrder - b.rotationOrder || a.id.localeCompare(b.id));
}

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
  date: string;
  employees: Employee[];
  settings: Settings;
  overrides: Record<string, Shift>;
  off: string[];
}

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
