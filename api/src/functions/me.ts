import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { canEdit, emailOf, getPrincipal, roleFor } from "../lib/auth";
import { listEmployees, listViewers } from "../lib/store";
import { autoSeal } from "../lib/service";
import { json } from "../lib/http";

// GET /api/me — used by the frontend to gate the UI. Works even when the user
// is signed in but not yet authorised (so we can show an "ask an admin" screen).
app.http("me", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "me",
  handler: async (req: HttpRequest, ctx: InvocationContext) => {
    const principal = getPrincipal(req);
    const email = emailOf(principal);
    if (!email) return json(200, { signedIn: false, authorized: false });

    const [employees, viewers] = await Promise.all([listEmployees(), listViewers()]);
    const role = roleFor(email, employees, viewers);

    if (role) {
      // Advance history sealing whenever an authorised user loads the app.
      try {
        await autoSeal();
      } catch (e) {
        ctx.error("autoSeal failed", e);
      }
    }
    const me = employees.find((e) => e.email === email) || null;
    return json(200, {
      signedIn: true,
      authorized: !!role,
      role: role ?? null,
      canEdit: canEdit(role),
      email,
      isAdmin: role === "admin",
      displayName: me?.displayName ?? principal?.userDetails ?? email,
      employeeId: me?.id ?? null,
    });
  },
});
