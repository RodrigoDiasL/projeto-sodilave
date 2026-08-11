import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getReportingPeriods } from "@/lib/reporting-periods";

export type MachineProductionCounter = {
  machineId: number;
  code: string;
  name: string;
  day: number;
  week: number;
  month: number;
  quarter: number;
  semester: number;
  year: number;
  total: number;
};

export type AdminProductionStats = {
  machines: MachineProductionCounter[];
  totalProduced: number;
  todayProduced: number;
  refreshedAt: Date;
};

type AggregateRow = {
  machineId: number;
  dayCount: bigint | number | string;
  weekCount: bigint | number | string;
  monthCount: bigint | number | string;
  quarterCount: bigint | number | string;
  semesterCount: bigint | number | string;
  yearCount: bigint | number | string;
  totalCount: bigint | number | string;
};

const numberValue = (value: bigint | number | string | null | undefined) => Number(value ?? 0);

export async function getAdminProductionStats(now = new Date()): Promise<AdminProductionStats> {
  const periods = getReportingPeriods(now);
  const [machines, rows] = await Promise.all([
    db.machine.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    db.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        machineId,
        SUM(CASE WHEN finalizedAt >= ${periods.day} THEN COALESCE(quantityProduced, 0) ELSE 0 END) AS dayCount,
        SUM(CASE WHEN finalizedAt >= ${periods.week} THEN COALESCE(quantityProduced, 0) ELSE 0 END) AS weekCount,
        SUM(CASE WHEN finalizedAt >= ${periods.month} THEN COALESCE(quantityProduced, 0) ELSE 0 END) AS monthCount,
        SUM(CASE WHEN finalizedAt >= ${periods.quarter} THEN COALESCE(quantityProduced, 0) ELSE 0 END) AS quarterCount,
        SUM(CASE WHEN finalizedAt >= ${periods.semester} THEN COALESCE(quantityProduced, 0) ELSE 0 END) AS semesterCount,
        SUM(CASE WHEN finalizedAt >= ${periods.year} THEN COALESCE(quantityProduced, 0) ELSE 0 END) AS yearCount,
        SUM(COALESCE(quantityProduced, 0)) AS totalCount
      FROM Production
      WHERE status = 'FINALIZED'
      GROUP BY machineId
    `),
  ]);

  const byMachine = new Map(rows.map((row) => [row.machineId, row]));
  const counters = machines.map((machine) => {
    const row = byMachine.get(machine.id);
    return {
      machineId: machine.id,
      code: machine.code,
      name: machine.name,
      day: numberValue(row?.dayCount),
      week: numberValue(row?.weekCount),
      month: numberValue(row?.monthCount),
      quarter: numberValue(row?.quarterCount),
      semester: numberValue(row?.semesterCount),
      year: numberValue(row?.yearCount),
      total: numberValue(row?.totalCount),
    };
  });

  return {
    machines: counters,
    totalProduced: counters.reduce((sum, row) => sum + row.total, 0),
    todayProduced: counters.reduce((sum, row) => sum + row.day, 0),
    refreshedAt: now,
  };
}
