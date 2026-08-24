"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { getShift, getShiftWindow } from "@/lib/shift";
import { OilLevel, RecordStatus } from "@prisma/client";
import { assertMachineRunning } from "@/lib/active-machines";
import { saveRecordConfirmation, verifySecondWorker } from "@/lib/second-worker-confirmation";

const n = (v: FormDataEntryValue | null) => v === null || v === "" ? null : Number(v);
const checkOptional = (v: number | null, min: number, max: number, label: string) => {
  if (v !== null && (!Number.isFinite(v) || v < min || v > max)) throw new Error(`${label} tem um valor inválido.`);
};
function assertWithinOriginalShift(observedAt:Date){const window=getShiftWindow(observedAt);if(new Date()>=window.end)throw new Error("Esta verificação só pode ser alterada durante o turno em que foi registada.");}

export async function saveMachineCheckup(formData: FormData) {
  const user = await requireOperationalUser();
  const intent = String(formData.get("intent") || "draft");
  const finalize = intent === "finalize";
  if (!["draft", "finalize"].includes(intent)) throw new Error("Ação inválida.");
  const secondWorker = finalize ? await verifySecondWorker(formData, user.id) : null;
  const id = n(formData.get("checkupId"));
  const machineId = n(formData.get("machineId"));
  if (machineId === null || !Number.isInteger(machineId) || machineId <= 0) throw new Error("Selecione uma máquina para guardar a verificação de turno.");
  const existing = id ? await db.machineCheckup.findUnique({ where: { id }, select: { id: true, status: true, observedAt:true, finalizedAt:true } }) : null;
  if(existing?.status===RecordStatus.CANCELLED)throw new Error("Esta verificação foi cancelada.");
  if(existing?.status===RecordStatus.FINALIZED)assertWithinOriginalShift(existing.observedAt);
  const effectiveStatus=existing?.status===RecordStatus.FINALIZED?RecordStatus.FINALIZED:(finalize?RecordStatus.FINALIZED:RecordStatus.DRAFT);
  const oilTempC = n(formData.get("oilTempC")), waterPressure = n(formData.get("waterPressure")), airPressure = n(formData.get("airPressure"));
  checkOptional(oilTempC, -20, 150, "A temperatura do óleo"); checkOptional(waterPressure, 0, 50, "A pressão de água"); checkOptional(airPressure, 0, 50, "A pressão de ar");
  const oilLevelValue = String(formData.get("oilLevel") || "");
  const oilLevel = Object.values(OilLevel).includes(oilLevelValue as OilLevel) ? oilLevelValue as OilLevel : null;
  if ((finalize||effectiveStatus===RecordStatus.FINALIZED) && (oilTempC === null || waterPressure === null || airPressure === null || oilLevel === null)) throw new Error("Preencha todos os campos obrigatórios antes de finalizar a verificação de turno.");
  await assertMachineRunning(machineId);
  const shiftCode=existing?.id?undefined:getShift().code;
  const data = { machineId, shiftCode, status:effectiveStatus, oilTempC, oilLevel, waterPressure, airPressure,
    cleanMachineArea: formData.get("cleanMachineArea") === "on",
    hasBreakdown:false,breakdownStoppedMachine:false,breakdownDescription:null,
    notes: String(formData.get("notes") || "").trim().slice(0, 500) || null, finalizedAt: effectiveStatus===RecordStatus.FINALIZED ? (existing?.finalizedAt??new Date()) : null };

  const row=await db.$transaction(async tx=>{
    const current=id?await tx.machineCheckup.findUnique({where:{id},select:{id:true,status:true}}):null;
    if(id&&!current)throw new Error("Esta verificação já não existe.");
    if(current?.status===RecordStatus.CANCELLED)throw new Error("Esta verificação foi cancelada.");
    const saved=current
      ? await tx.machineCheckup.update({where:{id:current.id},data})
      : await tx.machineCheckup.create({data:{...data,shiftCode:getShift().code,operatorId:user.id}});
    if(finalize&&secondWorker)await saveRecordConfirmation("MachineCheckup",saved.id,secondWorker.id,tx);
    await tx.auditLog.create({data:{userId:user.id,action:current?"EDIT":finalize?"FINALIZE":"CREATE",entity:"MachineCheckup",entityId:String(saved.id),details:{status:effectiveStatus,secondWorkerId:secondWorker?.id??null,secondWorkerName:secondWorker?.name??null}}});
    return saved;
  });

  revalidatePath("/checkups"); revalidatePath("/admin/checkups"); revalidatePath("/dashboard"); return { ok: true, id: row.id, finalized: effectiveStatus===RecordStatus.FINALIZED };
}

export async function saveGeneralCheck(formData: FormData) {
  const user = await requireOperationalUser();
  const intent = String(formData.get("intent") || "draft");
  const finalize = intent === "finalize";
  if (!["draft", "finalize"].includes(intent)) throw new Error("Ação inválida.");
  const secondWorker = finalize ? await verifySecondWorker(formData, user.id) : null;
  const id = n(formData.get("generalId"));
  const existing = id ? await db.shiftGeneralCheck.findUnique({ where: { id }, select: { id: true, status: true, observedAt:true, finalizedAt:true } }) : null;
  if(existing?.status===RecordStatus.CANCELLED)throw new Error("Esta verificação foi cancelada.");
  if(existing?.status===RecordStatus.FINALIZED)assertWithinOriginalShift(existing.observedAt);
  const effectiveStatus=existing?.status===RecordStatus.FINALIZED?RecordStatus.FINALIZED:(finalize?RecordStatus.FINALIZED:RecordStatus.DRAFT);
  const chillerLargeC = n(formData.get("chillerLargeC")), chillerSmallC = n(formData.get("chillerSmallC")), ambientTempC = n(formData.get("ambientTempC"));
  checkOptional(chillerLargeC, -30, 80, "A temperatura do refrigerador grande"); checkOptional(chillerSmallC, -30, 80, "A temperatura do refrigerador pequeno"); checkOptional(ambientTempC, -10, 60, "A temperatura ambiente");
  if ((finalize||effectiveStatus===RecordStatus.FINALIZED) && (chillerLargeC === null || chillerSmallC === null || ambientTempC === null)) throw new Error("Preencha as temperaturas dos refrigeradores antes de finalizar.");
  const data = { shiftCode: existing?undefined:getShift().code, status:effectiveStatus, chillerLargeC, chillerSmallC, ambientTempC,
    cleanDispatch: formData.get("cleanDispatch") === "on", cleanStorage: formData.get("cleanStorage") === "on", cleanProduction: formData.get("cleanProduction") === "on",
    notes: String(formData.get("generalNotes") || "").trim().slice(0, 500) || null, finalizedAt: effectiveStatus===RecordStatus.FINALIZED ? (existing?.finalizedAt??new Date()) : null };

  const row=await db.$transaction(async tx=>{
    const current=id?await tx.shiftGeneralCheck.findUnique({where:{id},select:{id:true,status:true}}):null;
    if(id&&!current)throw new Error("Esta verificação já não existe.");
    if(current?.status===RecordStatus.CANCELLED)throw new Error("Esta verificação foi cancelada.");
    const saved=current
      ? await tx.shiftGeneralCheck.update({where:{id:current.id},data})
      : await tx.shiftGeneralCheck.create({data:{...data,shiftCode:getShift().code,operatorId:user.id}});
    if(finalize&&secondWorker)await saveRecordConfirmation("ShiftGeneralCheck",saved.id,secondWorker.id,tx);
    await tx.auditLog.create({data:{userId:user.id,action:current?"EDIT":finalize?"FINALIZE":"CREATE",entity:"ShiftGeneralCheck",entityId:String(saved.id),details:{status:effectiveStatus,secondWorkerId:secondWorker?.id??null,secondWorkerName:secondWorker?.name??null}}});
    return saved;
  });

  revalidatePath("/checkups"); revalidatePath("/admin/checkups"); revalidatePath("/dashboard"); return { ok: true, id: row.id, finalized: effectiveStatus===RecordStatus.FINALIZED };
}
