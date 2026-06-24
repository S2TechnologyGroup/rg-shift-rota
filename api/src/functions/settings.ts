import { app, type HttpRequest } from "@azure/functions";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { getSettings, saveSettings } from "../lib/store";
import { sealBeforeMutation } from "../lib/service";
import { mondayOf, SHIFTS, type Settings } from "../lib/rota";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/settings        read settings
// PUT /api/settings        update settings (shift times, targets, anchor, working days)
app.http("settings", {
  methods: ["GET", "PUT"],
  authLevel: "anonymous",
  route: "settings",
  handler: authed(async (req: HttpRequest) => {
    if (req.method === "GET") {
      return json(200, await getSettings());
    }

    // Changing the pattern must not rewrite history.
    await sealBeforeMutation();
    const current = await getSettings();
    const body = (await req.json()) as Partial<Settings>;

    const next: Settings = { ...current };

    if (body.shiftTimes) {
      for (const s of SHIFTS) {
        const w = body.shiftTimes[s];
        if (!w || !TIME_RE.test(w.start) || !TIME_RE.test(w.end)) {
          throw new HttpError(400, { error: `Invalid time for ${s} (use HH:MM).` });
        }
      }
      next.shiftTimes = body.shiftTimes;
    }
    if (body.earliesTarget !== undefined) {
      next.earliesTarget = Math.max(1, Math.floor(Number(body.earliesTarget)));
    }
    if (body.latesTarget !== undefined) {
      next.latesTarget = Math.max(1, Math.floor(Number(body.latesTarget)));
    }
    if (body.anchorMonday) {
      next.anchorMonday = mondayOf(body.anchorMonday); // normalise to a Monday
    }
    if (body.workingDays) {
      const wd = body.workingDays.map(Number).filter((n) => n >= 1 && n <= 7);
      if (wd.length === 0) throw new HttpError(400, { error: "Pick at least one working day." });
      next.workingDays = Array.from(new Set(wd)).sort((a, b) => a - b);
    }

    // sealedThrough is managed by the server only — never accept it from clients.
    next.sealedThrough = current.sealedThrough;

    await saveSettings(next);
    return json(200, next);
  }),
});
