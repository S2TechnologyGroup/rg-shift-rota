import type { Settings, Shift } from "../types";

export const SHIFT_LABEL: Record<Shift, string> = {
  early: "Earlies",
  late: "Lates",
  normal: "Normal",
};

export function shiftTime(shift: Shift, settings: Settings): string {
  const w = settings.shiftTimes[shift];
  return `${w.start}–${w.end}`;
}

const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function dowLabel(weekday: number): string {
  return DOW[weekday] ?? "";
}

export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
