import { app, type HttpRequest } from "@azure/functions";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { deleteLogo, getLogo, putLogo } from "../lib/store";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"];

// GET    /api/branding/logo   stream the logo image (any signed-in user)
// POST   /api/branding/logo   { dataUrl }  upload a logo (editors only)
// DELETE /api/branding/logo   remove the logo (editors only)
app.http("brandingLogo", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "anonymous",
  route: "branding/logo",
  handler: authed(async (req: HttpRequest, _ctx, user) => {
    if (req.method === "GET") {
      const logo = await getLogo();
      if (!logo) return { status: 404 };
      return {
        status: 200,
        headers: { "Content-Type": logo.contentType, "Cache-Control": "no-cache" },
        body: new Uint8Array(logo.data),
      };
    }

    if (!user.canEdit) {
      throw new HttpError(403, { error: "You have view-only access and can't make changes." });
    }

    if (req.method === "DELETE") {
      await deleteLogo();
      return json(200, { removed: true });
    }

    // POST { dataUrl: "data:image/png;base64,...." }
    const body = (await req.json()) as { dataUrl?: string };
    const m = /^data:([^;]+);base64,(.+)$/.exec(body.dataUrl ?? "");
    if (!m) throw new HttpError(400, { error: "Provide the image as a base64 data URL." });
    const contentType = m[1].toLowerCase();
    if (!ALLOWED.includes(contentType)) {
      throw new HttpError(400, { error: `Unsupported image type. Use PNG, JPEG, SVG, WEBP or GIF.` });
    }
    const data = Buffer.from(m[2], "base64");
    if (data.length === 0) throw new HttpError(400, { error: "The image appears to be empty." });
    if (data.length > MAX_BYTES) {
      throw new HttpError(400, { error: "Logo is too large (max 2 MB)." });
    }
    await putLogo(data, contentType);
    return json(201, { ok: true, contentType });
  }),
});
