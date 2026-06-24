import { app, type HttpRequest } from "@azure/functions";
import { authedEditor } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { setDayOff, setWeekOff } from "../lib/service";
import { getSettings } from "../lib/store";
import { workingDaysOfWeek } from "../lib/rota";

// POST /api/timeoff  set or clear time off:
//   single day : { date, employeeId, off: true|false }
//   whole week : { weekOf: "<any date in week>", employeeId, off: true|false }
app.http("timeoff", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "timeoff",
  handler: authedEditor(async (req: HttpRequest) => {
    const body = (await req.json()) as {
      date?: string;
      weekOf?: string;
      employeeId?: string;
      off?: boolean;
    };
    const { employeeId } = body;
    const isOff = body.off !== false; // default true
    if (!employeeId) throw new HttpError(400, { error: "employeeId is required." });

    if (body.weekOf) {
      const settings = await getSettings();
      const dates = workingDaysOfWeek(body.weekOf, settings);
      const views = await setWeekOff(dates, employeeId, isOff);
      return json(200, { days: views });
    }

    if (body.date) {
      const view = await setDayOff(body.date, employeeId, isOff);
      return json(200, { days: [view] });
    }

    throw new HttpError(400, { error: "Provide either date or weekOf." });
  }),
});
