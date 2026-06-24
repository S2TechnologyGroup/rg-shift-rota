import { app, type HttpRequest } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { authed } from "../lib/handler";
import { HttpError, json } from "../lib/http";
import { deleteEmployee, listEmployees, upsertEmployee } from "../lib/store";
import { sealBeforeMutation } from "../lib/service";
import type { Employee } from "../lib/rota";

function validEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

// GET    /api/employees           list
// POST   /api/employees           create { displayName, email }
// PUT    /api/employees           update { id, displayName?, email?, rotationOrder?, active? }
// DELETE /api/employees?id=...     delete
app.http("employees", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "anonymous",
  route: "employees",
  handler: authed(async (req: HttpRequest, _ctx, user) => {
    if (req.method === "GET") {
      const employees = (await listEmployees()).sort(
        (a, b) => a.rotationOrder - b.rotationOrder
      );
      return json(200, employees);
    }

    if (!user.canEdit) {
      throw new HttpError(403, { error: "You have view-only access and can't make changes." });
    }

    // Any roster change must not retroactively alter history.
    await sealBeforeMutation();
    const employees = await listEmployees();

    if (req.method === "POST") {
      const body = (await req.json()) as Partial<Employee>;
      const displayName = (body.displayName ?? "").trim();
      const email = (body.email ?? "").trim().toLowerCase();
      if (!displayName) throw new HttpError(400, { error: "Name is required." });
      if (!validEmail(email)) throw new HttpError(400, { error: "A valid email is required." });
      if (employees.some((e) => e.email === email)) {
        throw new HttpError(409, { error: "An employee with that email already exists." });
      }
      const emp: Employee = {
        id: randomUUID(),
        displayName,
        email,
        rotationOrder: employees.length
          ? Math.max(...employees.map((e) => e.rotationOrder)) + 1
          : 0,
        active: true,
      };
      await upsertEmployee(emp);
      return json(201, emp);
    }

    if (req.method === "PUT") {
      const body = (await req.json()) as Partial<Employee> & { id: string };
      const existing = employees.find((e) => e.id === body.id);
      if (!existing) throw new HttpError(404, { error: "Employee not found." });
      const email = body.email !== undefined ? body.email.trim().toLowerCase() : existing.email;
      if (!validEmail(email)) throw new HttpError(400, { error: "A valid email is required." });
      if (employees.some((e) => e.email === email && e.id !== existing.id)) {
        throw new HttpError(409, { error: "Another employee already uses that email." });
      }
      const updated: Employee = {
        ...existing,
        displayName: body.displayName?.trim() || existing.displayName,
        email,
        rotationOrder:
          body.rotationOrder !== undefined ? Number(body.rotationOrder) : existing.rotationOrder,
        active: body.active !== undefined ? !!body.active : existing.active,
      };
      await upsertEmployee(updated);
      return json(200, updated);
    }

    // DELETE
    const id = req.query.get("id");
    if (!id) throw new HttpError(400, { error: "id query param required." });
    await deleteEmployee(id);
    return json(200, { deleted: id });
  }),
});
