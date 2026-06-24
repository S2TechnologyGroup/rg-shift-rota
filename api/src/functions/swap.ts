import { app, type HttpRequest } from "@azure/functions";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { swapDay } from "../lib/service";

// POST /api/swap  { date, aId, bId }  — swap two people's shifts for one day
app.http("swap", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "swap",
  handler: authed(async (req: HttpRequest) => {
    const { date, aId, bId } = (await req.json()) as {
      date?: string;
      aId?: string;
      bId?: string;
    };
    if (!date || !aId || !bId) {
      throw new HttpError(400, { error: "date, aId and bId are required." });
    }
    const view = await swapDay(date, aId, bId);
    return json(200, view);
  }),
});
