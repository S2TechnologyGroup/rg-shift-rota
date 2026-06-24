import type { HttpRequest } from "@azure/functions";
import type { Employee } from "./rota";

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string; // typically the email / UPN
  userRoles: string[];
  claims?: { typ: string; val: string }[];
}

/** Decode the Static Web Apps `x-ms-client-principal` header (base64 JSON). */
export function getPrincipal(req: HttpRequest): ClientPrincipal | null {
  const header = req.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded) as ClientPrincipal;
  } catch {
    return null;
  }
}

export function emailOf(p: ClientPrincipal | null): string {
  return (p?.userDetails ?? "").trim().toLowerCase();
}

function adminAllowlist(): string[] {
  return (process.env.ALLOWED_ADMINS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Authorisation for the Free-plan model: a signed-in M365 user is allowed only
 * if their email is a bootstrap admin or matches an active employee.
 */
export function isAuthorized(email: string, employees: Employee[]): boolean {
  if (!email) return false;
  if (adminAllowlist().includes(email)) return true;
  return employees.some((e) => e.active && e.email.toLowerCase() === email);
}

export function isAdmin(email: string): boolean {
  return !!email && adminAllowlist().includes(email);
}
