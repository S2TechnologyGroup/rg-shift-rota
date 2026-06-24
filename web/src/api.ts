import type { Branding, DayView, Employee, Me, RotaResponse, Settings, Shift } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public reasons?: string[]) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function req<T>(path: string, opts: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null; // non-JSON (e.g. an auth redirect page); treat as no body
  }
  if (!res.ok) {
    // Static Web Apps can briefly route a request to a function instance that
    // hasn't picked up app settings yet, yielding a transient 401/403. Retry
    // a couple of times before surfacing it so users don't see false errors.
    if ((res.status === 401 || res.status === 403) && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return req<T>(path, opts, attempt + 1);
    }
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

  getBranding: () => req<Branding>("/api/branding"),
  saveBranding: (b: { appName?: string; primaryColor?: string }) =>
    req<Branding>("/api/branding", { method: "PUT", body: JSON.stringify(b) }),
  uploadLogo: (dataUrl: string) =>
    req<{ ok: boolean }>("/api/branding/logo", {
      method: "POST",
      body: JSON.stringify({ dataUrl }),
    }),
  deleteLogo: () => req<{ removed: boolean }>("/api/branding/logo", { method: "DELETE" }),

  listViewers: () => req<string[]>("/api/viewers"),
  addViewer: (email: string) =>
    req<{ email: string }>("/api/viewers", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  removeViewer: (email: string) =>
    req<{ removed: string }>(`/api/viewers?email=${encodeURIComponent(email)}`, {
      method: "DELETE",
    }),
};
