/* Integration smoke test against Azurite Table Storage.
 * Verifies: rota generation, coverage validation, day swaps, history sealing,
 * and that sealed past days stay accurate after roster changes.
 * Run: node scripts/smoke.cjs  (with Azurite table running on :10002)
 */
process.env.TABLES_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.ALLOWED_ADMINS = "admin@example.com";

const crypto = require("node:crypto");
const store = require("../dist/lib/store.js");
const service = require("../dist/lib/service.js");
const rota = require("../dist/lib/rota.js");
const { addDays, mondayOf, todayISO, DEFAULT_SETTINGS } = rota;

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name);
  }
}
async function expectConflict(name, fn) {
  try {
    await fn();
    fail++;
    console.log("  ✗ " + name + " (expected a 409 but none thrown)");
  } catch (e) {
    ok(name, e && e.status === 409);
  }
}

function summary(days, date) {
  const d = days.find((x) => x.date === date);
  if (!d) return null;
  return d.assignments
    .map((a) => a.displayName + ":" + a.shift)
    .sort()
    .join(", ");
}

(async () => {
  console.log("Setting up fresh data...");
  const anchor = mondayOf(addDays(todayISO(), -21)); // 3 weeks ago
  await store.saveSettings({ ...DEFAULT_SETTINGS, anchorMonday: anchor, sealedThrough: null });

  // 6 employees
  const emps = [];
  for (let i = 0; i < 6; i++) {
    const e = {
      id: crypto.randomUUID(),
      displayName: "Emp" + i,
      email: `emp${i}@example.com`,
      rotationOrder: i,
      active: true,
    };
    emps.push(e);
    await store.upsertEmployee(e);
  }

  // ---- Past week (2 weeks ago): seal + capture ----
  const pastMon = mondayOf(addDays(todayISO(), -14));
  const r1 = await service.getRota(pastMon, addDays(pastMon, 6));
  const pastDate = r1[0].date;
  const before = summary(r1, pastDate);
  console.log("\nHistory accuracy:");
  ok("past week has working days", r1.length > 0);
  ok("past day is sealed", r1[0].sealed === true);
  ok("every past day meets coverage", r1.every((d) => d.validation.ok));

  // ---- Mutate roster: rename, remove one, add a new person ----
  await store.upsertEmployee({ ...emps[0], displayName: "RENAMED" });
  await store.deleteEmployee(emps[5].id);
  await store.upsertEmployee({
    id: crypto.randomUUID(),
    displayName: "NewHire",
    email: "new@example.com",
    rotationOrder: 99,
    active: true,
  });

  const r2 = await service.getRota(pastMon, addDays(pastMon, 6));
  const after = summary(r2, pastDate);
  ok("past day UNCHANGED after roster edits", before === after && before !== null);
  ok("past day still shows old name set (snapshot)", after.includes("Emp0:"));
  ok("past day does NOT include NewHire", !after.includes("NewHire"));

  // ---- Future week reflects the NEW roster ----
  console.log("\nFuture week reflects current pattern:");
  const futMon = mondayOf(addDays(todayISO(), 7));
  const r3 = await service.getRota(futMon, addDays(futMon, 6));
  const futStr = summary(r3, r3[0].date);
  ok("future day not sealed", r3[0].sealed === false);
  ok("future day includes NewHire", futStr.includes("NewHire"));
  ok("future day meets coverage on target", r3[0].validation.ok);

  // ---- Single-day swap ----
  console.log("\nPer-day swap + validation:");
  const futDate = r3[0].date;
  const day = r3[0].assignments;
  const early = day.find((a) => a.shift === "early");
  const normal = day.find((a) => a.shift === "normal");
  const swapped = await service.swapDay(futDate, early.employeeId, normal.employeeId);
  const sNames = swapped.assignments;
  ok(
    "swap exchanged the two shifts",
    sNames.find((a) => a.employeeId === early.employeeId).shift === "normal" &&
      sNames.find((a) => a.employeeId === normal.employeeId).shift === "early"
  );
  ok("swap keeps coverage valid", swapped.validation.ok);
  // only that day changed
  const otherDay = r3[1].date;
  const r3b = await service.getRota(otherDay, otherDay);
  ok(
    "other day unchanged by the swap",
    summary(r3b, otherDay) === summary(r3, otherDay)
  );

  // ---- Coverage rule blocks bad overrides ----
  console.log("\nCoverage rule enforcement:");
  // Move the only late person to normal -> 0 lates -> must be blocked
  const lateP = r3[1].assignments.find((a) => a.shift === "late");
  await expectConflict("override that drops the only Late is blocked", () =>
    service.setDayOverride(otherDay, lateP.employeeId, "normal")
  );
  // Booking that late person off also breaks coverage -> blocked
  await expectConflict("booking off the only Late is blocked", () =>
    service.setDayOff(otherDay, lateP.employeeId, true)
  );

  // ---- Sealed past day cannot be edited ----
  console.log("\nSealed days are read-only:");
  const anEmp = (await store.listEmployees())[0];
  await expectConflict("editing a sealed past day is blocked", () =>
    service.setDayOverride(pastDate, anEmp.id, "late")
  );

  // ---- Roles ----
  console.log("\nRoles:");
  const auth = require("../dist/lib/auth.js");
  const empList = await store.listEmployees();
  ok("admin role from ALLOWED_ADMINS", auth.roleFor("admin@example.com", empList, []) === "admin");
  ok("member role from active employee", auth.roleFor("emp1@example.com", empList, []) === "member");
  ok(
    "viewer role from viewers list",
    auth.roleFor("v@example.com", empList, ["v@example.com"]) === "viewer"
  );
  ok("unknown user has no role", auth.roleFor("nobody@example.com", empList, []) === null);
  ok("viewer cannot edit", auth.canEdit("viewer") === false);
  ok("member can edit", auth.canEdit("member") === true);

  // ---- Viewers store ----
  console.log("\nViewers store:");
  await store.addViewer("Viewer@Example.com");
  ok("viewer persisted (lowercased)", (await store.listViewers()).includes("viewer@example.com"));
  await store.removeViewer("viewer@example.com");
  ok("viewer removed", !(await store.listViewers()).includes("viewer@example.com"));

  // ---- Alternating pattern ----
  console.log("\nAlternating pattern:");
  const slots = rota.buildWeekSlots(6, 2, 1);
  let altOK = true;
  for (let i = 0; i < slots.length; i++) {
    const cur = slots[i];
    const next = slots[(i + 1) % slots.length];
    if (cur !== "normal" && next !== "normal") altOK = false;
  }
  ok("every special week is followed by a normal week (n=6)", altOK);
  ok(
    "alternating slots keep coverage 2E/1L/3N",
    slots.filter((s) => s === "early").length === 2 &&
      slots.filter((s) => s === "late").length === 1 &&
      slots.filter((s) => s === "normal").length === 3
  );

  // ---- Branding (Table text + Blob logo) ----
  console.log("\nBranding:");
  const defB = await store.getBranding();
  ok("default branding name", defB.appName === "Shift Rota");
  await store.saveBranding({ appName: "Acme Rota", primaryColor: "#123456", logoContentType: "" });
  const b2 = await store.getBranding();
  ok("branding text persisted", b2.appName === "Acme Rota" && b2.primaryColor === "#123456");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
  try {
    await store.putLogo(png, "image/png");
    const gotLogo = await store.getLogo();
    ok(
      "logo stored & retrieved from blob",
      !!gotLogo && gotLogo.contentType === "image/png" && gotLogo.data.length === png.length
    );
    ok("branding now reports a logo", (await store.getBranding()).logoContentType === "image/png");
    await store.deleteLogo();
    ok("logo removed", (await store.getLogo()) === null);
  } catch (e) {
    if (String(e && e.message).includes("not supported by Azurite")) {
      console.log("  ~ logo blob skipped (local Azurite too old for blob API; works on real Azure)");
    } else {
      throw e;
    }
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("SMOKE ERROR:", e);
  process.exit(1);
});
