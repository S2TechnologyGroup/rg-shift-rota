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

export type Role = "admin" | "member" | "viewer";

/**
 * Determine a signed-in user's role (Free-plan model):
 *  - admin  : email is in the ALLOWED_ADMINS bootstrap list
 *  - member : email matches an active employee (appears in the rota, can edit)
 *  - viewer : email is on the viewers allowlist (can view, not in the rota, read-only)
 *  - null   : not authorised
 */
export function roleFor(
  email: string,
  employees: Employee[],
  viewers: string[]
): Role | null {
  if (!email) return null;
  if (adminAllowlist().includes(email)) return "admin";
  if (employees.some((e) => e.active && e.email.toLowerCase() === email)) return "member";
  if (viewers.map((v) => v.toLowerCase()).includes(email)) return "viewer";
  return null;
}

export function canEdit(role: Role | null): boolean {
  return role === "admin" || role === "member";
}

export function isAdmin(email: string): boolean {
  return !!email && adminAllowlist().includes(email);
}
