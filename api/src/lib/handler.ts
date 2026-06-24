import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { emailOf, getPrincipal, isAdmin, isAuthorized } from "./auth";
import { listEmployees } from "./store";
import { HttpError, json } from "./http";
import type { Employee } from "./rota";

export interface AuthedUser {
  email: string;
  isAdmin: boolean;
  employees: Employee[];
}

type Handler = (
  req: HttpRequest,
  ctx: InvocationContext,
  user: AuthedUser
) => Promise<HttpResponseInit>;

/** Wrap a handler with authentication, authorisation and error handling. */
export function authed(handler: Handler) {
  return async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const principal = getPrincipal(req);
      const email = emailOf(principal);
      if (!email) return json(401, { error: "Not signed in." });

      const employees = await listEmployees();
      if (!isAuthorized(email, employees)) {
        return json(403, {
          error: "Your account isn't set up yet. Ask an admin to add you as an employee.",
          email,
        });
      }
      return await handler(req, ctx, { email, isAdmin: isAdmin(email), employees });
    } catch (e) {
      if (e instanceof HttpError) {
        return json(e.status, typeof e.payload === "string" ? { error: e.payload } : e.payload);
      }
      ctx.error(e);
      return json(500, { error: (e as Error).message });
    }
  };
}
