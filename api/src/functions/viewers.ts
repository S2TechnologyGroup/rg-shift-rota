import { app, type HttpRequest } from "@azure/functions";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { addViewer, listViewers, removeViewer } from "../lib/store";

function validEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

// GET    /api/viewers              list view-only users
// POST   /api/viewers  { email }   add a viewer (editors only)
// DELETE /api/viewers?email=...     remove a viewer (editors only)
app.http("viewers", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "anonymous",
  route: "viewers",
  handler: authed(async (req: HttpRequest, _ctx, user) => {
    if (req.method === "GET") {
      return json(200, await listViewers());
    }

    if (!user.canEdit) {
      throw new HttpError(403, { error: "You have view-only access and can't make changes." });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as { email?: string };
      const email = (body.email ?? "").trim().toLowerCase();
      if (!validEmail(email)) throw new HttpError(400, { error: "A valid email is required." });
      await addViewer(email);
      return json(201, { email });
    }

    // DELETE
    const email = (req.query.get("email") ?? "").trim().toLowerCase();
    if (!email) throw new HttpError(400, { error: "email query param required." });
    await removeViewer(email);
    return json(200, { removed: email });
  }),
});
