import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { canEdit, emailOf, getPrincipal, roleFor, type Role } from "./auth";
import { listEmployees, listViewers } from "./store";
import { HttpError, json } from "./http";
import type { Employee } from "./rota";

export interface AuthedUser {
  email: string;
  role: Role;
  canEdit: boolean;
  employees: Employee[];
}

type Handler = (
  req: HttpRequest,
  ctx: InvocationContext,
  user: AuthedUser
) => Promise<HttpResponseInit>;

async function resolve(req: HttpRequest): Promise<AuthedUser | HttpResponseInit> {
  const principal = getPrincipal(req);
  const email = emailOf(principal);
  if (!email) return json(401, { error: "Not signed in." });

  const [employees, viewers] = await Promise.all([listEmployees(), listViewers()]);
  const role = roleFor(email, employees, viewers);
  if (!role) {
    return json(403, {
      error: "Your account isn't set up yet. Ask an admin to add you as an employee or viewer.",
      email,
    });
  }
  return { email, role, canEdit: canEdit(role), employees };
}

function wrap(handler: Handler, requireEditor: boolean) {
  return async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const result = await resolve(req);
      if ("status" in result) return result as HttpResponseInit; // auth error
      const user = result as AuthedUser;
      if (requireEditor && !user.canEdit) {
        return json(403, { error: "You have view-only access and can't make changes." });
      }
      return await handler(req, ctx, user);
    } catch (e) {
      if (e instanceof HttpError) {
        return json(e.status, typeof e.payload === "string" ? { error: e.payload } : e.payload);
      }
      ctx.error(e);
      return json(500, { error: (e as Error).message });
    }
  };
}

/** Any authorised role (admin, member or viewer). */
export function authed(handler: Handler) {
  return wrap(handler, false);
}

/** Editors only (admin or member); viewers get 403. */
export function authedEditor(handler: Handler) {
  return wrap(handler, true);
}
