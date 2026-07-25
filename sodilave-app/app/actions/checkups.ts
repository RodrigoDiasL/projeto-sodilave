"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getShift } from "@/lib/shift";
import { IncidentType, MachineEventType, MachineStatus, OilLevel, RecordStatus } from "@prisma/client";
import { changeMachineStatus } from "@/lib/machine-state";
import { assertMachineRunning } from "@/lib/active-machines";

const n = (v: FormDataEntryValue | null) => v === null || v === "" ? null : Number(v);
const checkOptional = (v: number | null, min: number, max: number, label: string) => {
  if (v !== null && (!Number.isFinite(v) || v < min || v > max)) throw new Error(`${label} tem um valor inválido.`);
};

export async function saveMachineCheckup(formData: FormData) {
  const user = await requireUser();
  const intent = String(formData.get("intent") || "draft");
  const finalize = intent === "finalize";
  if (!["draft", "finalize"].includes(intent)) throw new Error("Ação inválida.");
  const status = finalize ? RecordStatus.FINALIZED : RecordStatus.DRAFT;
  const id = n(formData.get("checkupId"));
  const machineId = n(formData.get("machineId"));
  if (machineId === null || !Number.isInteger(machineId) || machineId <= 0) throw new Error("Selecione uma máquina para guardar o verificação de turno.");
  const oilTempC = n(formData.get("oilTempC")), waterPressure = n(formData.get("waterPressure")), airPressure = n(formData.get("airPressure"));
  checkOptional(oilTempC, -20, 150, "A temperatura do óleo"); checkOptional(waterPressure, 0, 50, "A pressão de água"); checkOptional(airPressure, 0, 50, "A pressão de ar");
  const oilLevelValue = String(formData.get("oilLevel") || "");
  const oilLevel = Object.values(OilLevel).includes(oilLevelValue as OilLevel) ? oilLevelValue as OilLevel : null;
  if (finalize && (oilTempC === null || waterPressure === null || airPressure === null || oilLevel === null)) throw new Error("Preencha todos os campos obrigatórios antes de finalizar o verificação de turno.");
  await assertMachineRunning(machineId);
  const data = { machineId, shiftCode: getShift().code, status, oilTempC, oilLevel, waterPressure, airPressure,
    cleanMachineArea: formData.get("cleanMachineArea") === "on",
    hasBreakdown: formData.get("hasBreakdown") === "on",
    breakdownStoppedMachine: formData.get("breakdownStoppedMachine") === "on",
    breakdownDescription: String(formData.get("breakdownDescription") || "").trim().slice(0, 1000) || null,
    notes: String(formData.get("notes") || "").trim().slice(0, 500) || null, finalizedAt: finalize ? new Date() : null };
  const existing = id ? await db.machineCheckup.findUnique({ where: { id }, select: { id: true, status: true } }) : null;
  if (existing && existing.status !== RecordStatus.DRAFT) throw new Error("Este verificação de turno já foi finalizado.");
  const row = existing ? await db.machineCheckup.update({ where: { id: existing.id }, data }) : await db.machineCheckup.create({ data: { ...data, operatorId: user.id } });
  if (data.hasBreakdown && data.breakdownDescription) {
    const incident = await db.incident.upsert({ where: { checkupId: row.id }, update: { description: data.breakdownDescription, stoppedMachine: data.breakdownStoppedMachine }, create: { machineId, checkupId: row.id, type: IncidentType.BREAKDOWN, occurredAt: new Date(), description: data.breakdownDescription, stoppedMachine: data.breakdownStoppedMachine, createdById: user.id } });
    if (data.breakdownStoppedMachine) await changeMachineStatus({ machineId, toStatus: MachineStatus.STOPPED, type: MachineEventType.BREAKDOWN_STOP, userId: user.id, reason: "Avaria registada na verificação de turno", notes: data.breakdownDescription, incidentId: incident.id });
  }
  await db.auditLog.create({ data: { userId: user.id, action: finalize ? "FINALIZE" : existing ? "EDIT" : "CREATE", entity: "MachineCheckup", entityId: String(row.id), details: { status } } });
  revalidatePath("/checkups"); revalidatePath("/admin/checkups"); return { ok: true, id: row.id, finalized: finalize };
}

export async function saveGeneralCheck(formData: FormData) {
  const user = await requireUser();
  const intent = String(formData.get("intent") || "draft");
  const finalize = intent === "finalize";
  if (!["draft", "finalize"].includes(intent)) throw new Error("Ação inválida.");
  const status = finalize ? RecordStatus.FINALIZED : RecordStatus.DRAFT;
  const id = n(formData.get("generalId"));
  const chillerLargeC = n(formData.get("chillerLargeC")), chillerSmallC = n(formData.get("chillerSmallC")), ambientTempC = n(formData.get("ambientTempC"));
  checkOptional(chillerLargeC, -30, 80, "A temperatura do refrigerador grande"); checkOptional(chillerSmallC, -30, 80, "A temperatura do refrigerador pequeno"); checkOptional(ambientTempC, -10, 60, "A temperatura ambiente");
  if (finalize && (chillerLargeC === null || chillerSmallC === null || ambientTempC === null)) throw new Error("Preencha as temperaturas dos refrigeradores antes de finalizar.");
  const data = { shiftCode: getShift().code, status, chillerLargeC, chillerSmallC, ambientTempC,
    cleanDispatch: formData.get("cleanDispatch") === "on", cleanStorage: formData.get("cleanStorage") === "on", cleanProduction: formData.get("cleanProduction") === "on",
    notes: String(formData.get("generalNotes") || "").trim().slice(0, 500) || null, finalizedAt: finalize ? new Date() : null };
  const existing = id ? await db.shiftGeneralCheck.findUnique({ where: { id }, select: { id: true, status: true } }) : null;
  if (existing && existing.status !== RecordStatus.DRAFT) throw new Error("Este verificação de turno já foi finalizado.");
  const row = existing ? await db.shiftGeneralCheck.update({ where: { id: existing.id }, data }) : await db.shiftGeneralCheck.create({ data: { ...data, operatorId: user.id } });
  await db.auditLog.create({ data: { userId: user.id, action: finalize ? "FINALIZE" : existing ? "EDIT" : "CREATE", entity: "ShiftGeneralCheck", entityId: String(row.id), details: { status } } });
  revalidatePath("/checkups"); revalidatePath("/admin/checkups"); return { ok: true, id: row.id, finalized: finalize };
}
