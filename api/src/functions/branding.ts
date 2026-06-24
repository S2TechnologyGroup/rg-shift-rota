import { app, type HttpRequest } from "@azure/functions";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { getBranding, saveBranding } from "../lib/store";

const HEX = /^#[0-9a-fA-F]{6}$/;

// GET /api/branding  -> { appName, primaryColor, hasLogo }
// PUT /api/branding  { appName?, primaryColor? }  (editors only)
app.http("branding", {
  methods: ["GET", "PUT"],
  authLevel: "anonymous",
  route: "branding",
  handler: authed(async (req: HttpRequest, _ctx, user) => {
    if (req.method === "GET") {
      const b = await getBranding();
      return json(200, {
        appName: b.appName,
        primaryColor: b.primaryColor,
        hasLogo: !!b.logoContentType,
      });
    }

    if (!user.canEdit) {
      throw new HttpError(403, { error: "You have view-only access and can't make changes." });
    }

    const body = (await req.json()) as { appName?: string; primaryColor?: string };
    const current = await getBranding();
    const next = { ...current };

    if (body.appName !== undefined) {
      const name = body.appName.trim().slice(0, 60);
      if (!name) throw new HttpError(400, { error: "App name can't be empty." });
      next.appName = name;
    }
    if (body.primaryColor !== undefined) {
      if (!HEX.test(body.primaryColor)) {
        throw new HttpError(400, { error: "Colour must be a hex value like #2f6fed." });
      }
      next.primaryColor = body.primaryColor.toLowerCase();
    }
    await saveBranding(next);
    return json(200, {
      appName: next.appName,
      primaryColor: next.primaryColor,
      hasLogo: !!next.logoContentType,
    });
  }),
});
