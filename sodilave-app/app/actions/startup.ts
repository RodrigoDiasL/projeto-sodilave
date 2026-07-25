"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getShift } from "@/lib/shift";
import { MachineEventType, MachineStatus, RecordStatus, TestResult } from "@prisma/client";
import { changeMachineStatus } from "@/lib/machine-state";

const result = (fd: FormData, key: string) => {
  const value = String(fd.get(key) || "");
  return Object.values(TestResult).includes(value as TestResult) ? value as TestResult : null;
};

export async function saveWeeklyStartup(fd: FormData) {
  const user = await requireUser();
  const intent = String(fd.get("intent") || "draft");
  const finalize = intent === "finalize";
  const idValue = Number(fd.get("startupId") || 0);
  const machineIds = fd.getAll("machineIds").map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (finalize && !machineIds.length) throw new Error("Selecione pelo menos uma máquina para finalizar o arranque semanal.");
  const requiredGeneral = ["productionWindows", "storageWindows", "dispatchWindows", "forkliftIntegrity", "emergencyLighting"];
  if (finalize && requiredGeneral.some((key) => !result(fd, key))) throw new Error("Complete todas as verificações gerais antes de finalizar.");

  const existing = idValue ? await db.weeklyStartup.findUnique({ where: { id: idValue } }) : null;
  if (!existing) {
    const lastStartup = await db.weeklyStartup.findFirst({ where: { status: RecordStatus.FINALIZED }, orderBy: { startupDate: "desc" }, include: { shutdown: true } });
    if (lastStartup && !lastStartup.shutdown) throw new Error("Antes de iniciar uma nova semana, finalize a paragem semanal do arranque anterior.");
  }

  const data = {
    operatorId: user.id,
    status: finalize ? RecordStatus.FINALIZED : RecordStatus.DRAFT,
    shiftCode: getShift().code,
    chillerSmall: fd.get("chillerSmall") === "on",
    chillerLarge: fd.get("chillerLarge") === "on",
    coolingPump: fd.get("coolingPump") === "on",
    compressor: fd.get("compressor") === "on",
    airDryers: fd.get("airDryers") === "on",
    airDemolecularizer: fd.get("airDemolecularizer") === "on",
    productionWindows: result(fd, "productionWindows"),
    storageWindows: result(fd, "storageWindows"),
    dispatchWindows: result(fd, "dispatchWindows"),
    forkliftIntegrity: result(fd, "forkliftIntegrity"),
    emergencyLighting: result(fd, "emergencyLighting"),
    observations: String(fd.get("observations") || "").trim().slice(0, 1500) || null,
    finalizedAt: finalize ? new Date() : null,
  };
  if (existing?.status === RecordStatus.FINALIZED) throw new Error("Este arranque já foi finalizado.");
  const startup = existing
    ? await db.weeklyStartup.update({ where: { id: idValue }, data })
    : await db.weeklyStartup.create({ data });
  await db.weeklyStartupMachine.deleteMany({ where: { weeklyStartupId: startup.id } });
  for (const machineId of machineIds) {
    const prefix = `m${machineId}_`;
    const checks = {
      acrylics: result(fd, prefix + "acrylics"),
      plasticTrays: result(fd, prefix + "plasticTrays"),
      lighting: result(fd, prefix + "lighting"),
      extruderTemperatures: result(fd, prefix + "extruderTemperatures"),
      lubrication: result(fd, prefix + "lubrication"),
      mouldCleaning: result(fd, prefix + "mouldCleaning"),
      beltsTraysTables: result(fd, prefix + "beltsTraysTables"),
      waterFilters: result(fd, prefix + "waterFilters"),
    };
    if (finalize && Object.values(checks).some((v) => !v)) throw new Error(`Complete as verificações da máquina ${machineId}.`);
    await db.weeklyStartupMachine.create({ data: { weeklyStartupId: startup.id, machineId, ...checks } });
  }
  if (finalize) for (const machineId of machineIds) await changeMachineStatus({ machineId, toStatus: MachineStatus.RUNNING, type: MachineEventType.WEEKLY_STARTUP, userId: user.id, reason: "Arranque semanal", occurredAt: startup.startupDate });
  await db.auditLog.create({ data: { userId: user.id, action: finalize ? "FINALIZE" : existing ? "EDIT" : "CREATE", entity: "WeeklyStartup", entityId: String(startup.id) } });
  revalidatePath("/startup"); revalidatePath("/dashboard"); revalidatePath("/production"); revalidatePath("/checkups");
  return { id: startup.id, finalized: finalize };
}
