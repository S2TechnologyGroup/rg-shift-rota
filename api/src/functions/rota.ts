import { app, type HttpRequest } from "@azure/functions";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { getRota } from "../lib/service";
import { addDays, parseISO } from "../lib/rota";

// GET /api/rota?from=YYYY-MM-DD&to=YYYY-MM-DD
app.http("rota", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "rota",
  handler: authed(async (req: HttpRequest) => {
    const from = req.query.get("from");
    const to = req.query.get("to");
    if (!from || !to) throw new HttpError(400, { error: "from and to are required." });

    const span =
      (parseISO(to).getTime() - parseISO(from).getTime()) / (24 * 60 * 60 * 1000);
    if (Number.isNaN(span) || span < 0) throw new HttpError(400, { error: "Invalid date range." });
    if (span > 370) throw new HttpError(400, { error: "Range too large (max ~1 year)." });

    const days = await getRota(from, to);
    return json(200, { from, to, days, nextFrom: addDays(to, 1) });
  }),
});
