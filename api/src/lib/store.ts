import { TableClient, odata, RestError } from "@azure/data-tables";
import {
  DEFAULT_SETTINGS,
  type DayAssignment,
  type Employee,
  type Settings,
  type Shift,
} from "./rota";

const CONN =
  process.env.TABLES_CONNECTION_STRING || "UseDevelopmentStorage=true"; // Azurite default

const TABLES = {
  employees: "Employees",
  settings: "Settings",
  overrides: "DayOverrides",
  off: "DayOff",
  records: "DayRecords",
  viewers: "Viewers",
} as const;

const clients = new Map<string, TableClient>();

async function table(name: string): Promise<TableClient> {
  let c = clients.get(name);
  if (!c) {
    c = TableClient.fromConnectionString(CONN, name, {
      allowInsecureConnection: true, // needed for local Azurite over http
    });
    try {
      await c.createTable();
    } catch (e) {
      // 409 = table already exists; ignore.
      if (!(e instanceof RestError) || e.statusCode !== 409) throw e;
    }
    clients.set(name, c);
  }
  return c;
}

// ---------------------------------------------------------------- Employees

export async function listEmployees(): Promise<Employee[]> {
  const t = await table(TABLES.employees);
  const out: Employee[] = [];
  for await (const e of t.listEntities<any>({
    queryOptions: { filter: odata`PartitionKey eq 'emp'` },
  })) {
    out.push({
      id: e.rowKey,
      displayName: e.displayName,
      email: String(e.email ?? "").toLowerCase(),
      rotationOrder: Number(e.rotationOrder ?? 0),
      active: e.active !== false,
    });
  }
  return out;
}

export async function upsertEmployee(emp: Employee): Promise<void> {
  const t = await table(TABLES.employees);
  await t.upsertEntity(
    {
      partitionKey: "emp",
      rowKey: emp.id,
      displayName: emp.displayName,
      email: emp.email.toLowerCase(),
      rotationOrder: emp.rotationOrder,
      active: emp.active,
    },
    "Replace"
  );
}

export async function deleteEmployee(id: string): Promise<void> {
  const t = await table(TABLES.employees);
  try {
    await t.deleteEntity("emp", id);
  } catch (e) {
    if (!(e instanceof RestError) || e.statusCode !== 404) throw e;
  }
}

// ---------------------------------------------------------------- Viewers
// View-only users: can see the rota but are not part of it and cannot edit.

export async function listViewers(): Promise<string[]> {
  const t = await table(TABLES.viewers);
  const out: string[] = [];
  for await (const e of t.listEntities<any>({
    queryOptions: { filter: odata`PartitionKey eq 'viewer'` },
  })) {
    out.push(String(e.email ?? e.rowKey).toLowerCase());
  }
  return out;
}

export async function addViewer(email: string): Promise<void> {
  const t = await table(TABLES.viewers);
  const key = email.toLowerCase();
  await t.upsertEntity({ partitionKey: "viewer", rowKey: key, email: key }, "Replace");
}

export async function removeViewer(email: string): Promise<void> {
  const t = await table(TABLES.viewers);
  try {
    await t.deleteEntity("viewer", email.toLowerCase());
  } catch (e) {
    if (!(e instanceof RestError) || e.statusCode !== 404) throw e;
  }
}

// ---------------------------------------------------------------- Settings

export async function getSettings(): Promise<Settings> {
  const t = await table(TABLES.settings);
  try {
    const e: any = await t.getEntity("cfg", "global");
    return {
      shiftTimes: JSON.parse(e.shiftTimes),
      earliesTarget: Number(e.earliesTarget),
      latesTarget: Number(e.latesTarget),
      anchorMonday: e.anchorMonday,
      workingDays: String(e.workingDays)
        .split(",")
        .map(Number)
        .filter((n) => !Number.isNaN(n)),
      sealedThrough: e.sealedThrough || null,
    };
  } catch (e) {
    if (e instanceof RestError && e.statusCode === 404) return { ...DEFAULT_SETTINGS };
    throw e;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const t = await table(TABLES.settings);
  await t.upsertEntity(
    {
      partitionKey: "cfg",
      rowKey: "global",
      shiftTimes: JSON.stringify(s.shiftTimes),
      earliesTarget: s.earliesTarget,
      latesTarget: s.latesTarget,
      anchorMonday: s.anchorMonday,
      workingDays: s.workingDays.join(","),
      sealedThrough: s.sealedThrough || "",
    },
    "Replace"
  );
}

// ---------------------------------------------------- Day overrides / days off

type DateKeyedShifts = Record<string, Record<string, Shift>>; // date -> empId -> shift
type DateKeyedIds = Record<string, string[]>; // date -> empId[]

export async function getOverridesRange(from: string, to: string): Promise<DateKeyedShifts> {
  const t = await table(TABLES.overrides);
  const map: DateKeyedShifts = {};
  for await (const e of t.listEntities<any>({
    queryOptions: { filter: odata`PartitionKey ge ${from} and PartitionKey le ${to}` },
  })) {
    (map[e.partitionKey] ||= {})[e.rowKey] = e.shift as Shift;
  }
  return map;
}

export async function setOverride(date: string, empId: string, shift: Shift): Promise<void> {
  const t = await table(TABLES.overrides);
  await t.upsertEntity({ partitionKey: date, rowKey: empId, shift }, "Replace");
}

export async function clearOverride(date: string, empId: string): Promise<void> {
  const t = await table(TABLES.overrides);
  try {
    await t.deleteEntity(date, empId);
  } catch (e) {
    if (!(e instanceof RestError) || e.statusCode !== 404) throw e;
  }
}

export async function getOffRange(from: string, to: string): Promise<DateKeyedIds> {
  const t = await table(TABLES.off);
  const map: DateKeyedIds = {};
  for await (const e of t.listEntities<any>({
    queryOptions: { filter: odata`PartitionKey ge ${from} and PartitionKey le ${to}` },
  })) {
    (map[e.partitionKey] ||= []).push(e.rowKey);
  }
  return map;
}

export async function setOff(date: string, empId: string): Promise<void> {
  const t = await table(TABLES.off);
  await t.upsertEntity({ partitionKey: date, rowKey: empId }, "Replace");
}

export async function clearOff(date: string, empId: string): Promise<void> {
  const t = await table(TABLES.off);
  try {
    await t.deleteEntity(date, empId);
  } catch (e) {
    if (!(e instanceof RestError) || e.statusCode !== 404) throw e;
  }
}

// ---------------------------------------------------- Day records (frozen history)

export async function getRecordsRange(
  from: string,
  to: string
): Promise<Record<string, DayAssignment[]>> {
  const t = await table(TABLES.records);
  const map: Record<string, DayAssignment[]> = {};
  for await (const e of t.listEntities<any>({
    queryOptions: { filter: odata`PartitionKey ge ${from} and PartitionKey le ${to}` },
  })) {
    (map[e.partitionKey] ||= []).push({
      employeeId: e.rowKey,
      displayName: e.displayName,
      shift: e.shift as Shift,
    });
  }
  return map;
}

export async function writeDayRecord(
  date: string,
  a: DayAssignment
): Promise<void> {
  const t = await table(TABLES.records);
  await t.upsertEntity(
    {
      partitionKey: date,
      rowKey: a.employeeId,
      displayName: a.displayName,
      shift: a.shift,
    },
    "Replace"
  );
}
