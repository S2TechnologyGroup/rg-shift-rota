import { describe, it, expect } from "vitest";
import {
  buildWeekSlots,
  weekIndex,
  mondayOf,
  isoWeekday,
  addDays,
  baseWeekShifts,
  resolveDay,
  validateDay,
  DEFAULT_SETTINGS,
  type Employee,
  type Settings,
  type Shift,
} from "./rota";

const settings: Settings = { ...DEFAULT_SETTINGS, anchorMonday: "2024-01-01" }; // a Monday

function mkEmployees(n: number): Employee[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    displayName: `Emp ${i}`,
    email: `emp${i}@example.com`,
    rotationOrder: i,
    active: true,
  }));
}

function counts(shifts: Shift[]) {
  return {
    early: shifts.filter((s) => s === "early").length,
    late: shifts.filter((s) => s === "late").length,
    normal: shifts.filter((s) => s === "normal").length,
  };
}

describe("date helpers", () => {
  it("mondayOf returns the Monday of the week", () => {
    expect(mondayOf("2024-01-03")).toBe("2024-01-01"); // Wed -> Mon
    expect(mondayOf("2024-01-07")).toBe("2024-01-01"); // Sun -> Mon
    expect(mondayOf("2024-01-08")).toBe("2024-01-08"); // Mon -> Mon
  });
  it("isoWeekday: Mon=1..Sun=7", () => {
    expect(isoWeekday("2024-01-01")).toBe(1);
    expect(isoWeekday("2024-01-07")).toBe(7);
  });
  it("weekIndex counts whole weeks from anchor (incl negative)", () => {
    expect(weekIndex("2024-01-01", "2024-01-01")).toBe(0);
    expect(weekIndex("2024-01-08", "2024-01-01")).toBe(1);
    expect(weekIndex("2023-12-25", "2024-01-01")).toBe(-1);
  });
});

describe("buildWeekSlots", () => {
  it("n=6 -> 2 early, 1 late, 3 normal", () => {
    expect(counts(buildWeekSlots(6))).toEqual({ early: 2, late: 1, normal: 3 });
  });
  it("n=8 -> 2 early, 1 late, 5 normal", () => {
    expect(counts(buildWeekSlots(8))).toEqual({ early: 2, late: 1, normal: 5 });
  });
  it("n=3 -> 2 early, 1 late, 0 normal", () => {
    expect(counts(buildWeekSlots(3))).toEqual({ early: 2, late: 1, normal: 0 });
  });
  it("n=2 -> 1 early, 1 late (coverage preserved)", () => {
    expect(counts(buildWeekSlots(2))).toEqual({ early: 1, late: 1, normal: 0 });
  });
  it("n=1 -> single early", () => {
    expect(buildWeekSlots(1)).toEqual(["early"]);
  });
  it("n=0 -> empty", () => {
    expect(buildWeekSlots(0)).toEqual([]);
  });
});

describe("rotation", () => {
  it("every week has exactly target coverage for n=6", () => {
    const emps = mkEmployees(6);
    for (let w = -3; w <= 10; w++) {
      const map = baseWeekShifts(emps, w, settings);
      expect(counts([...map.values()])).toEqual({ early: 2, late: 1, normal: 3 });
    }
  });
  it("is a clean cycle: each person returns to start after n weeks", () => {
    const emps = mkEmployees(6);
    const w0 = baseWeekShifts(emps, 0, settings);
    const wN = baseWeekShifts(emps, 6, settings);
    for (const e of emps) expect(wN.get(e.id)).toBe(w0.get(e.id));
  });
  it("everyone cycles through all distinct shift positions over n weeks", () => {
    const emps = mkEmployees(6);
    const seen = new Map<string, Set<Shift>>(emps.map((e) => [e.id, new Set()]));
    for (let w = 0; w < 6; w++) {
      const map = baseWeekShifts(emps, w, settings);
      for (const e of emps) seen.get(e.id)!.add(map.get(e.id)!);
    }
    // With 2E/1L/3N, every employee should touch early, late and normal at least once
    for (const e of emps) {
      expect(seen.get(e.id)!.has("early")).toBe(true);
      expect(seen.get(e.id)!.has("late")).toBe(true);
      expect(seen.get(e.id)!.has("normal")).toBe(true);
    }
  });
});

describe("resolveDay + validateDay", () => {
  const emps = mkEmployees(6);
  const monday = "2024-01-08"; // weekIndex 1

  it("applies a day-off (person dropped from the day)", () => {
    const all = resolveDay({ date: monday, employees: emps, settings, overrides: {}, off: [] });
    const without = resolveDay({
      date: monday,
      employees: emps,
      settings,
      overrides: {},
      off: [emps[0].id],
    });
    expect(without.length).toBe(all.length - 1);
    expect(without.find((a) => a.employeeId === emps[0].id)).toBeUndefined();
  });

  it("applies a single-day override only", () => {
    const res = resolveDay({
      date: monday,
      employees: emps,
      settings,
      overrides: { [emps[3].id]: "late" },
      off: [],
    });
    expect(res.find((a) => a.employeeId === emps[3].id)!.shift).toBe("late");
  });

  it("blocks a day with zero lates", () => {
    // Force everyone to early/normal -> no late
    const overrides: Record<string, Shift> = {};
    const day = resolveDay({ date: monday, employees: emps, settings, overrides, off: [] });
    for (const a of day) if (a.shift === "late") overrides[a.employeeId] = "normal";
    const broken = resolveDay({ date: monday, employees: emps, settings, overrides, off: [] });
    const v = validateDay(broken, settings);
    expect(v.ok).toBe(false);
    expect(v.lates).toBe(0);
  });

  it("a two-person swap that keeps 1E/1L is valid", () => {
    const day = resolveDay({ date: monday, employees: emps, settings, overrides: {}, off: [] });
    const anEarly = day.find((a) => a.shift === "early")!;
    const aNormal = day.find((a) => a.shift === "normal")!;
    const overrides: Record<string, Shift> = {
      [anEarly.employeeId]: "normal",
      [aNormal.employeeId]: "early",
    };
    const swapped = resolveDay({ date: monday, employees: emps, settings, overrides, off: [] });
    const v = validateDay(swapped, settings);
    expect(v.ok).toBe(true);
    expect(v.earlies).toBe(2);
    expect(v.lates).toBe(1);
  });

  it("default day for n=6 is on target", () => {
    const day = resolveDay({ date: monday, employees: emps, settings, overrides: {}, off: [] });
    const v = validateDay(day, settings);
    expect(v.ok).toBe(true);
    expect(v.onTarget).toBe(true);
  });

  it("headcount change auto-adjusts coverage (add a 7th)", () => {
    const emps7 = mkEmployees(7);
    const day = resolveDay({ date: monday, employees: emps7, settings, overrides: {}, off: [] });
    const v = validateDay(day, settings);
    expect(v.earlies).toBe(2);
    expect(v.lates).toBe(1);
    expect(v.normals).toBe(4);
  });
});
