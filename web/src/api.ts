import type { DayView, Employee, Me, RotaResponse, Settings, Shift } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public reasons?: string[]) {
    super(message);
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || res.statusText, data?.reasons);
  }
  return data as T;
}

export const api = {
  me: () => req<Me>("/api/me"),

  rota: (from: string, to: string) =>
    req<RotaResponse>(`/api/rota?from=${from}&to=${to}`),

  listEmployees: () => req<Employee[]>("/api/employees"),
  createEmployee: (displayName: string, email: string) =>
    req<Employee>("/api/employees", {
      method: "POST",
      body: JSON.stringify({ displayName, email }),
    }),
  updateEmployee: (emp: Partial<Employee> & { id: string }) =>
    req<Employee>("/api/employees", { method: "PUT", body: JSON.stringify(emp) }),
  deleteEmployee: (id: string) =>
    req<{ deleted: string }>(`/api/employees?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  setOverride: (date: string, employeeId: string, shift: Shift) =>
    req<DayView>("/api/overrides", {
      method: "POST",
      body: JSON.stringify({ date, employeeId, shift }),
    }),
  clearOverride: (date: string, employeeId: string) =>
    req<DayView>("/api/overrides", {
      method: "DELETE",
      body: JSON.stringify({ date, employeeId }),
    }),

  swap: (date: string, aId: string, bId: string) =>
    req<DayView>("/api/swap", {
      method: "POST",
      body: JSON.stringify({ date, aId, bId }),
    }),

  timeOffDay: (date: string, employeeId: string, off: boolean) =>
    req<{ days: DayView[] }>("/api/timeoff", {
      method: "POST",
      body: JSON.stringify({ date, employeeId, off }),
    }),
  timeOffWeek: (weekOf: string, employeeId: string, off: boolean) =>
    req<{ days: DayView[] }>("/api/timeoff", {
      method: "POST",
      body: JSON.stringify({ weekOf, employeeId, off }),
    }),

  getSettings: () => req<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) =>
    req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
};
