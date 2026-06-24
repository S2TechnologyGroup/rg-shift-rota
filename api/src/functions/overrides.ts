import { app, type HttpRequest } from "@azure/functions";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { setDayOverride } from "../lib/service";
import { SHIFTS, type Shift } from "../lib/rota";

// POST   /api/overrides  { date, employeeId, shift }   set a single day's shift
// DELETE /api/overrides  { date, employeeId }          reset that day to the pattern
app.http("overrides", {
  methods: ["POST", "DELETE"],
  authLevel: "anonymous",
  route: "overrides",
  handler: authed(async (req: HttpRequest) => {
    const body = (await req.json()) as { date?: string; employeeId?: string; shift?: Shift };
    const { date, employeeId } = body;
    if (!date || !employeeId) {
      throw new HttpError(400, { error: "date and employeeId are required." });
    }

    if (req.method === "DELETE") {
      const view = await setDayOverride(date, employeeId, null);
      return json(200, view);
    }

    if (!body.shift || !SHIFTS.includes(body.shift)) {
      throw new HttpError(400, { error: "A valid shift (early|late|normal) is required." });
    }
    const view = await setDayOverride(date, employeeId, body.shift);
    return json(200, view);
  }),
});
