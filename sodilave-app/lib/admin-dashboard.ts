import { MachineStatus, Prisma, RecordStatus, TestResult } from "@prisma/client";
import { db } from "@/lib/db";
import { calculateUptime } from "@/lib/machine-state";

export type ActivityTone = "green" | "blue" | "yellow" | "red" | "orange" | "neutral";

export type AdminActivityItem = {
  key: string;
  title: string;
  subtitle: string;
  occurredAt: Date;
  href: string;
  tone: ActivityTone;
};

export type MachineUptime = {
  id: number;
  code: string;
  name: string;
  status: MachineStatus;
  weeklyPercentage: number;
  totalPercentage: number;
  weeklyHours: number;
  cycles: number;
};

export type AdminDashboardData = {
  activity: AdminActivityItem[];
  uptime: MachineUptime[];
};

type CavitySummary = {
  productionId: number;
  hasWeights: number;
  testCount: bigint | number;
  nonConformingCount: bigint | number;
};

const priorityCodes = ["2", "3", "4", "7", "5", "6"];

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function productionTone(production: any, cavity?: CavitySummary): ActivityTone {
  const hasNonConforming = production.tests.some((test: any) => test.result === TestResult.NON_CONFORMING)
    || Number(cavity?.nonConformingCount ?? 0) > 0;
  if (hasNonConforming) return "red";
  if (production.status === RecordStatus.DRAFT) return "yellow";

  const percentageTotal = production.materials.reduce(
    (sum: number, material: any) => sum + Number(material.percentage ?? 0),
    0,
  );
  const materialsComplete = production.materials.length > 0
    && production.materials.every((material: any) => Number(material.quantityKg ?? 0) > 0 && Number(material.percentage ?? 0) > 0)
    && Math.abs(percentageTotal - 100) < 0.001;
  const leftComplete = production.initialWeightG !== null
    && production.midWeightG !== null
    && production.quantityProduced !== null
    && production.tests.length >= 4;
  const rightComplete = production.machine.code !== "7"
    || (Number(cavity?.hasWeights ?? 0) === 1 && Number(cavity?.testCount ?? 0) >= 4);

  if (!materialsComplete || !leftComplete || !rightComplete) return "orange";
  return hasText(production.observations) ? "blue" : "green";
}

function machineCheckTone(check: any): ActivityTone {
  if (check.status === RecordStatus.DRAFT) return "yellow";
  const complete = check.oilTempC !== null
    && check.oilLevel !== null
    && check.waterPressure !== null
    && check.airPressure !== null;
  if (!complete) return "orange";
  return hasText(check.notes) || hasText(check.breakdownDescription) ? "blue" : "green";
}

function generalCheckTone(check: any): ActivityTone {
  if (check.status === RecordStatus.DRAFT) return "yellow";
  const complete = check.chillerLargeC !== null
    && check.chillerSmallC !== null
    && check.ambientTempC !== null;
  if (!complete) return "orange";
  return hasText(check.notes) ? "blue" : "green";
}

function roundPercentage(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function getAdminDashboardData(now = new Date()): Promise<AdminDashboardData> {
  const [
    productions,
    machineChecks,
    generalChecks,
    startups,
    shutdowns,
    incidents,
    maintenances,
    stateEvents,
    machines,
    cycles,
  ] = await Promise.all([
    db.production.findMany({
      where: { status: { not: RecordStatus.CANCELLED } },
      include: { machine: true, product: true, tests: true, materials: true },
      orderBy: { updatedAt: "desc" },
      take: 18,
    }),
    db.machineCheckup.findMany({
      where: { status: { not: RecordStatus.CANCELLED } },
      include: { machine: true },
      orderBy: { updatedAt: "desc" },
      take: 18,
    }),
    db.shiftGeneralCheck.findMany({
      where: { status: { not: RecordStatus.CANCELLED } },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    db.weeklyStartup.findMany({
      where: { status: { not: RecordStatus.CANCELLED } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    db.weeklyShutdown.findMany({
      where: { status: { not: RecordStatus.CANCELLED } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    db.incident.findMany({
      include: { machine: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.maintenance.findMany({
      include: { machines: { include: { machine: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.machineEvent.findMany({
      where: { type: { in: ["INTERMEDIATE_STARTUP", "MANUAL_STOP"] } },
      include: { machine: true },
      orderBy: { occurredAt: "desc" },
      take: 12,
    }),
    db.machine.findMany({
      where: { code: { in: priorityCodes } },
      orderBy: { code: "asc" },
    }),
    db.weeklyStartup.findMany({
      where: { status: RecordStatus.FINALIZED },
      include: {
        machines: { select: { machineId: true } },
        shutdown: true,
      },
      orderBy: { startupDate: "asc" },
    }),
  ]);

  const machine7Ids = productions.filter((production) => production.machine.code === "7").map((production) => production.id);
  const cavityRows = machine7Ids.length
    ? await db.$queryRaw<CavitySummary[]>(Prisma.sql`
        SELECT
          p.id AS productionId,
          CASE WHEN pcd.rightInitialWeightG IS NOT NULL AND pcd.rightMidWeightG IS NOT NULL THEN 1 ELSE 0 END AS hasWeights,
          COUNT(pct.id) AS testCount,
          SUM(CASE WHEN pct.result = 'NON_CONFORMING' THEN 1 ELSE 0 END) AS nonConformingCount
        FROM Production p
        LEFT JOIN ProductionCavityData pcd ON pcd.productionId = p.id
        LEFT JOIN ProductionCavityTest pct ON pct.productionId = p.id AND pct.cavity = 'RIGHT'
        WHERE p.id IN (${Prisma.join(machine7Ids)})
        GROUP BY p.id, pcd.rightInitialWeightG, pcd.rightMidWeightG
      `)
    : [];
  const cavityByProduction = new Map(cavityRows.map((row) => [row.productionId, row]));

  const activity: AdminActivityItem[] = [
    ...productions.map((production) => ({
      key: `production-${production.id}`,
      title: `Produção · Máquina ${production.machine.code}`,
      subtitle: `${production.product.name} · ${production.productionLot}`,
      occurredAt: production.updatedAt,
      href: `/admin/productions/${production.id}`,
      tone: productionTone(production, cavityByProduction.get(production.id)),
    })),
    ...machineChecks.map((check) => ({
      key: `machine-check-${check.id}`,
      title: `Verificação · Máquina ${check.machine.code}`,
      subtitle: check.status === RecordStatus.DRAFT ? "Em preenchimento" : "Verificação da máquina registada",
      occurredAt: check.updatedAt,
      href: `/admin/checkups/machine/${check.id}`,
      tone: machineCheckTone(check),
    })),
    ...generalChecks.map((check) => ({
      key: `general-check-${check.id}`,
      title: "Verificação geral do turno",
      subtitle: check.status === RecordStatus.DRAFT ? "Em preenchimento" : `Turno ${check.shiftCode}`,
      occurredAt: check.updatedAt,
      href: `/admin/checkups/general/${check.id}`,
      tone: generalCheckTone(check),
    })),
    ...startups.map((startup) => ({
      key: `startup-${startup.id}`,
      title: "Arranque semanal",
      subtitle: startup.status === RecordStatus.DRAFT ? "Em preenchimento" : `Turno ${startup.shiftCode}`,
      occurredAt: startup.updatedAt,
      href: "/startup",
      tone: startup.status === RecordStatus.DRAFT ? "yellow" as const : hasText(startup.observations) ? "blue" as const : "green" as const,
    })),
    ...shutdowns.map((shutdown) => ({
      key: `shutdown-${shutdown.id}`,
      title: "Paragem semanal",
      subtitle: shutdown.status === RecordStatus.DRAFT ? "Em preenchimento" : `Turno ${shutdown.shiftCode}`,
      occurredAt: shutdown.updatedAt,
      href: "/shutdown",
      tone: shutdown.status === RecordStatus.DRAFT ? "yellow" as const : hasText(shutdown.observations) ? "blue" as const : "neutral" as const,
    })),
    ...incidents.map((incident) => ({
      key: `incident-${incident.id}`,
      title: `${incident.type === "BREAKDOWN" ? "Avaria" : "Paragem"} · Máquina ${incident.machine.code}`,
      subtitle: incident.description,
      occurredAt: incident.occurredAt,
      href: "/incidents",
      tone: "red" as const,
    })),
    ...maintenances.map((maintenance) => ({
      key: `maintenance-${maintenance.id}`,
      title: `Manutenção · ${maintenance.machines.map((row) => row.machine.code).join(", ") || "Sem máquina"}`,
      subtitle: maintenance.status === "OPEN" ? "Intervenção em aberto" : "Intervenção concluída",
      occurredAt: maintenance.updatedAt,
      href: "/maintenance",
      tone: maintenance.status === "OPEN" ? "yellow" as const : "blue" as const,
    })),
    ...stateEvents.map((event) => ({
      key: `machine-event-${event.id}`,
      title: `${event.type === "INTERMEDIATE_STARTUP" ? "Arranque intermédio" : "Paragem"} · Máquina ${event.machine.code}`,
      subtitle: event.reason || event.notes || (event.toStatus === MachineStatus.RUNNING ? "Máquina colocada em funcionamento" : "Máquina parada"),
      occurredAt: event.occurredAt,
      href: "/machines",
      tone: event.toStatus === MachineStatus.RUNNING ? "green" as const : "orange" as const,
    })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 40);

  const orderedMachines = [...machines].sort((a, b) => priorityCodes.indexOf(a.code) - priorityCodes.indexOf(b.code));
  const earliestCycle = cycles[0]?.startupDate;
  const events = earliestCycle && orderedMachines.length
    ? await db.machineEvent.findMany({
        where: {
          machineId: { in: orderedMachines.map((machine) => machine.id) },
          occurredAt: { gte: earliestCycle, lte: now },
        },
        select: { machineId: true, occurredAt: true, toStatus: true },
        orderBy: { occurredAt: "asc" },
      })
    : [];

  const uptime: MachineUptime[] = orderedMachines.map((machine) => {
    const weeklyValues: { percentage: number; hours: number }[] = [];

    for (const cycle of cycles) {
      const from = cycle.startupDate;
      const completedShutdown = cycle.shutdown?.status === RecordStatus.FINALIZED ? cycle.shutdown : null;
      const to = completedShutdown?.shutdownDate ?? now;
      if (to.getTime() <= from.getTime()) continue;

      const cycleEvents = events
        .filter((event) => event.machineId === machine.id && event.occurredAt >= from && event.occurredAt <= to)
        .map((event) => ({ occurredAt: event.occurredAt, toStatus: event.toStatus }));
      const startedWithCycle = cycle.machines.some((row) => row.machineId === machine.id);
      if (startedWithCycle && !cycleEvents.some((event) => event.occurredAt.getTime() === from.getTime())) {
        cycleEvents.push({ occurredAt: from, toStatus: MachineStatus.RUNNING });
      }

      const result = calculateUptime(cycleEvents, from, to);
      weeklyValues.push({ percentage: result.percentage, hours: result.hours });
    }

    const current = weeklyValues.at(-1) ?? { percentage: 0, hours: 0 };
    const total = weeklyValues.length
      ? weeklyValues.reduce((sum, value) => sum + value.percentage, 0) / weeklyValues.length
      : 0;

    return {
      id: machine.id,
      code: machine.code,
      name: machine.name,
      status: machine.status,
      weeklyPercentage: roundPercentage(current.percentage),
      totalPercentage: roundPercentage(total),
      weeklyHours: Math.round(current.hours * 10) / 10,
      cycles: weeklyValues.length,
    };
  });

  return { activity, uptime };
}
