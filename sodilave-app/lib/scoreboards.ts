import { RecordStatus, TestResult } from "@/lib/db-types";
import { db } from "@/lib/db";
import { getShift } from "@/lib/shift";
import { dateKey, getReportingPeriods, isSince } from "@/lib/reporting-periods";

export type ProductionPeriods = {
  week: number;
  month: number;
  quarter: number;
  year: number;
};

export type ProblemMetrics = {
  incidents: number;
  breakdowns: number;
  stoppages: number;
  nonConformingProductions: number;
  productionsWithObservations: number;
};

export type EmployeeScoreRow = {
  userId: number;
  name: string;
  active: boolean;
  shiftsWorked: ProductionPeriods;
  production: ProductionPeriods;
  problems: ProblemMetrics;
};

export type ShiftScoreRow = {
  code: string;
  label: string;
  hours: string;
  workedDays: ProductionPeriods;
  production: ProductionPeriods;
  problems: ProblemMetrics;
};

export type ScoreboardData = {
  employees: EmployeeScoreRow[];
  shifts: ShiftScoreRow[];
  generatedAt: Date;
};

type ConfirmationRow = { entity: string; entityId: number; confirmedById: number };
type CavityNonConformingRow = { productionId: number };

const shiftInfo: Record<string, { label: string; hours: string }> = {
  A: { label: "Noite", hours: "00:00 – 08:00" },
  B: { label: "Manhã", hours: "08:00 – 16:00" },
  C: { label: "Tarde", hours: "16:00 – 24:00" },
};
const shiftOrder = ["B", "C", "A"];

const emptyPeriods = (): ProductionPeriods => ({ week: 0, month: 0, quarter: 0, year: 0 });
const emptyProblems = (): ProblemMetrics => ({
  incidents: 0,
  breakdowns: 0,
  stoppages: 0,
  nonConformingProductions: 0,
  productionsWithObservations: 0,
});

function addToPeriods(target: ProductionPeriods, at: Date, value: number, starts: ReturnType<typeof getReportingPeriods>) {
  if (isSince(at, starts.week)) target.week += value;
  if (isSince(at, starts.month)) target.month += value;
  if (isSince(at, starts.quarter)) target.quarter += value;
  if (isSince(at, starts.year)) target.year += value;
}

function addOneToPeriods(target: ProductionPeriods, at: Date, starts: ReturnType<typeof getReportingPeriods>) {
  addToPeriods(target, at, 1, starts);
}

function shiftKey(at: Date, shiftCode: string) {
  return `${dateKey(at)}|${shiftCode}`;
}

export async function getScoreboardData(now = new Date()): Promise<ScoreboardData> {
  const starts = getReportingPeriods(now);
  const [users, productions, machineChecks, generalChecks, incidents, confirmations] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["OPERATOR", "PRODUCTION_MANAGER", "LOGISTICS"] } },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
    db.production.findMany({
      where: { recordOrigin:{in:["PRODUCTION","HISTORICAL_IMPORT"]}, status: RecordStatus.FINALIZED, startedAt: { gte: starts.year } },
      select: {
        id: true,
        operatorId: true,
        shiftCode: true,
        startedAt: true,
        quantityProduced: true,
        observations: true,
        machine: { select: { code: true } },
        tests: { select: { result: true } },
      },
      orderBy: { startedAt: "asc" },
    }),
    db.machineCheckup.findMany({
      where: { status: RecordStatus.FINALIZED, observedAt: { gte: starts.year } },
      select: { id: true, operatorId: true, shiftCode: true, observedAt: true },
    }),
    db.shiftGeneralCheck.findMany({
      where: { status: RecordStatus.FINALIZED, observedAt: { gte: starts.year } },
      select: { id: true, operatorId: true, shiftCode: true, observedAt: true },
    }),
    db.incident.findMany({
      where: { occurredAt: { gte: starts.year } },
      select: { type: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
    db.$queryRaw<ConfirmationRow[]>`
      SELECT entity, entityId, confirmedById
      FROM RecordConfirmation
      WHERE entity IN ('Production','MachineCheckup','ShiftGeneralCheck')
    `,
  ]);

  const eligibleIds = new Set(users.map((user) => user.id));
  const confirmationByRecord = new Map(confirmations.map((row) => [`${row.entity}:${row.entityId}`, row.confirmedById]));
  const employeeRows = new Map<number, EmployeeScoreRow>(users.map((user) => [user.id, {
    userId: user.id,
    name: user.name,
    active: user.active,
    shiftsWorked: emptyPeriods(),
    production: emptyPeriods(),
    problems: emptyProblems(),
  }]));

  const shiftRows = new Map<string, ShiftScoreRow>(Object.entries(shiftInfo).map(([code, info]) => [code, {
    code,
    label: info.label,
    hours: info.hours,
    workedDays: emptyPeriods(),
    production: emptyPeriods(),
    problems: emptyProblems(),
  }]));

  const participantsByShift = new Map<string, Set<number>>();
  const employeeShiftDates = new Map<number, Map<string, Date>>();
  const observedShiftDates = new Map<string, Date>();

  function registerShift(userId: number, at: Date, shiftCode: string) {
    if (!eligibleIds.has(userId)) return;
    const key = shiftKey(at, shiftCode);
    const members = participantsByShift.get(key) ?? new Set<number>();
    members.add(userId);
    participantsByShift.set(key, members);
    const dates = employeeShiftDates.get(userId) ?? new Map<string, Date>();
    dates.set(key, at);
    employeeShiftDates.set(userId, dates);
    observedShiftDates.set(key, at);
  }

  function recordParticipants(entity: string, id: number, operatorId: number, at: Date, shiftCode: string) {
    registerShift(operatorId, at, shiftCode);
    const secondId = confirmationByRecord.get(`${entity}:${id}`);
    if (secondId) registerShift(secondId, at, shiftCode);
  }

  for (const production of productions) recordParticipants("Production", production.id, production.operatorId, production.startedAt, production.shiftCode);
  for (const check of machineChecks) recordParticipants("MachineCheckup", check.id, check.operatorId, check.observedAt, check.shiftCode);
  for (const check of generalChecks) recordParticipants("ShiftGeneralCheck", check.id, check.operatorId, check.observedAt, check.shiftCode);

  for (const [userId, dates] of employeeShiftDates) {
    const row = employeeRows.get(userId);
    if (!row) continue;
    for (const at of dates.values()) addOneToPeriods(row.shiftsWorked, at, starts);
  }
  for (const [key, at] of observedShiftDates) {
    const code = key.split("|")[1];
    const row = shiftRows.get(code);
    if (row) addOneToPeriods(row.workedDays, at, starts);
  }

  const machine7ProductionIds = productions.filter((production) => production.machine.code === "7").map((production) => production.id);
  const cavityNonConforming = machine7ProductionIds.length
    ? await db.query<CavityNonConformingRow[]>(
        `SELECT DISTINCT productionId
         FROM ProductionCavityTest
         WHERE productionId IN (${machine7ProductionIds.map(() => "?").join(",")})
           AND result = 'NON_CONFORMING'`,
        machine7ProductionIds,
      )
    : [];
  const cavityNonConformingIds = new Set(cavityNonConforming.map((row) => row.productionId));

  for (const production of productions) {
    const participantIds = new Set<number>();
    if (eligibleIds.has(production.operatorId)) participantIds.add(production.operatorId);
    const secondId = confirmationByRecord.get(`Production:${production.id}`);
    if (secondId && eligibleIds.has(secondId)) participantIds.add(secondId);

    const quantity = Number(production.quantityProduced ?? 0);
    const hasObservation = Boolean(production.observations?.trim());
    const nonConforming = production.tests.some((test:any) => test.result === TestResult.NON_CONFORMING)
      || cavityNonConformingIds.has(production.id);

    for (const userId of participantIds) {
      const row = employeeRows.get(userId);
      if (!row) continue;
      addToPeriods(row.production, production.startedAt, quantity, starts);
      if (hasObservation) row.problems.productionsWithObservations += 1;
      if (nonConforming) row.problems.nonConformingProductions += 1;
    }

    const shiftRow = shiftRows.get(production.shiftCode);
    if (shiftRow) {
      addToPeriods(shiftRow.production, production.startedAt, quantity, starts);
      if (hasObservation) shiftRow.problems.productionsWithObservations += 1;
      if (nonConforming) shiftRow.problems.nonConformingProductions += 1;
    }
  }

  for (const incident of incidents) {
    const code = getShift(incident.occurredAt).code;
    const key = shiftKey(incident.occurredAt, code);
    const shiftRow = shiftRows.get(code);
    if (shiftRow) {
      shiftRow.problems.incidents += 1;
      if (incident.type === "BREAKDOWN") shiftRow.problems.breakdowns += 1;
      if (incident.type === "STOPPAGE") shiftRow.problems.stoppages += 1;
    }

    for (const userId of participantsByShift.get(key) ?? []) {
      const row = employeeRows.get(userId);
      if (!row) continue;
      row.problems.incidents += 1;
      if (incident.type === "BREAKDOWN") row.problems.breakdowns += 1;
      if (incident.type === "STOPPAGE") row.problems.stoppages += 1;
    }
  }

  const employees = [...employeeRows.values()].sort((a, b) =>
    b.production.year - a.production.year
    || b.shiftsWorked.year - a.shiftsWorked.year
    || a.name.localeCompare(b.name, "pt"),
  );
  const shifts = shiftOrder.map((code) => shiftRows.get(code)!).filter(Boolean);

  return { employees, shifts, generatedAt: now };
}
