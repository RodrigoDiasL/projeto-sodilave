"use server";
import { UserInputError } from "@/lib/action-error";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { getShiftWindow } from "@/lib/shift";
import { OilLevel } from "@/lib/db-types";
import { saveRecordConfirmation, verifySecondWorker } from "@/lib/second-worker-confirmation";

function numberField(fd: FormData, key: string, min: number, max: number, label: string) {
  const raw = fd.get(key);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new UserInputError(`${label} tem um valor inválido.`);
  return value;
}
function recordId(fd: FormData, key: string) {
  const raw = fd.get(key);
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new UserInputError("Identificador da verificação inválido.");
  return id;
}

export async function saveShiftCheckups(fd: FormData) {
  const user = await requireOperationalUser();
  const intent = String(fd.get("intent") || "draft");
  if (!["draft", "finalize"].includes(intent)) throw new UserInputError("Ação inválida.");
  const window = getShiftWindow();
  if (fd.get("shiftStart") !== window.start.toISOString()) throw new UserInputError("O turno mudou. Atualize a página antes de guardar as verificações.");
  const machineIds = fd.getAll("machineIds").map(Number);
  if (!machineIds.length || machineIds.some(id => !Number.isInteger(id) || id <= 0) || new Set(machineIds).size !== machineIds.length) {
    throw new UserInputError("Selecione todas as máquinas em funcionamento.");
  }
  const secondWorker = intent === "finalize" ? await verifySecondWorker(fd, user.id) : null;
  const result = await db.$transaction(async tx => {
    // Same lock order as weekly startup/shutdown; also serializes duplicate submissions.
    await tx.query("SELECT id FROM Machine ORDER BY id FOR UPDATE");
    const startup = await tx.weeklyStartup.findFirst({ where: { status: "FINALIZED", shutdown: null } });
    const machines = await tx.machine.findMany({ where: { active: true, status: "RUNNING" }, orderBy: { id: "asc" } });
    if (!startup) throw new UserInputError("Não existe um arranque semanal ativo.");
    if (machines.length !== machineIds.length || machines.some(m => !machineIds.includes(m.id))) {
      throw new UserInputError("As máquinas em funcionamento mudaram. Atualize a página antes de guardar.");
    }
    const period = { observedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } };
    const getRecord = async (repo: typeof tx.machineCheckup, id: number | null, machineId?: number) => {
      const row = id ? await repo.findUnique({ where: { id } }) : await repo.findFirst({
        where: { ...period, ...(machineId ? { machineId } : {}) }, orderBy: { updatedAt: "desc" },
      });
      if (id && !row) throw new UserInputError("Esta verificação já não existe.");
      if (row && (row.status === "CANCELLED" || row.observedAt < window.start || row.observedAt >= window.end || (machineId && row.machineId !== machineId))) {
        throw new UserInputError("Esta verificação não pertence à máquina e ao turno atuais ou foi cancelada.");
      }
      return row;
    };
    const general = await getRecord(tx.shiftGeneralCheck, recordId(fd, "generalId"));
    const records = [];
    for (const machine of machines) records.push({ machine, row: await getRecord(tx.machineCheckup, recordId(fd, `m${machine.id}_checkupId`), machine.id) });
    if (intent === "draft" && (general?.status === "FINALIZED" || records.some(({ row }) => row?.status === "FINALIZED"))) throw new UserInputError("Use Finalizar verificações do turno para alterar verificações já finalizadas.");
    const save = async (repo: typeof tx.machineCheckup, entity: string, row: any, data: Record<string, unknown>) => {
      const finalized = intent === "finalize" || row?.status === "FINALIZED";
      const values = { ...data, status: finalized ? "FINALIZED" : "DRAFT", finalizedAt: finalized ? row?.finalizedAt ?? new Date() : null };
      const saved = row ? await repo.update({ where: { id: row.id }, data: values })
        : await repo.create({ data: { ...values, operatorId: user.id, shiftCode: window.code, observedAt: new Date() } });
      if (finalized && secondWorker) await saveRecordConfirmation(entity, saved.id, secondWorker, user.id, tx);
      await tx.auditLog.create({ data: { userId: user.id, action: row ? "EDIT" : finalized ? "FINALIZE" : "CREATE", entity, entityId: String(saved.id), details: { status: values.status, secondWorkerId: secondWorker?.id ?? null } } });
      return { id: saved.id, finalized };
    };
    const chillerLargeC = numberField(fd, "chillerLargeC", -30, 80, "A temperatura do refrigerador grande");
    const chillerSmallC = numberField(fd, "chillerSmallC", -30, 80, "A temperatura do refrigerador pequeno");
    const ambientTempC = numberField(fd, "ambientTempC", -10, 60, "A temperatura ambiente");
    if ((intent === "finalize" || general?.status === "FINALIZED") && [chillerLargeC, chillerSmallC, ambientTempC].some(v => v === null)) {
      throw new UserInputError("Preencha as três temperaturas da verificação geral antes de finalizar.");
    }
    const savedGeneral = await save(tx.shiftGeneralCheck, "ShiftGeneralCheck", general, {
      chillerLargeC, chillerSmallC, ambientTempC,
      ...Object.fromEntries(["cleanDispatch", "cleanStorage", "cleanProduction", "purgePneumaticBarrels", "purgeCleanAirBarrels", "purgeFilters"].map(key => [key, fd.get(key) === "on"])),
      notes: String(fd.get("generalNotes") || "").trim().slice(0, 500) || null,
    });
    const savedMachines = [];
    for (const { machine, row } of records) {
      const prefix = `m${machine.id}_`;
      const oilTempC = numberField(fd, prefix + "oilTempC", -20, 150, `Máquina ${machine.code}: temperatura do óleo`);
      const waterPressure = numberField(fd, prefix + "waterPressure", 0, 50, `Máquina ${machine.code}: pressão de água`);
      const airPressure = numberField(fd, prefix + "airPressure", 0, 50, `Máquina ${machine.code}: pressão de ar`);
      const value = String(fd.get(prefix + "oilLevel") || "");
      const oilLevel = Object.values(OilLevel).includes(value as OilLevel) ? value : null;
      if ((intent === "finalize" || row?.status === "FINALIZED") && [oilTempC, waterPressure, airPressure, oilLevel].some(v => v === null)) {
        throw new UserInputError(`Máquina ${machine.code}: preencha a temperatura, o nível de óleo e as pressões antes de finalizar.`);
      }
      const saved = await save(tx.machineCheckup, "MachineCheckup", row, {
        machineId: machine.id, oilTempC, waterPressure, airPressure, oilLevel,
        cleanMachineArea: fd.get(prefix + "cleanMachineArea") === "on",
        hasBreakdown: false, breakdownStoppedMachine: false, breakdownDescription: null,
        notes: String(fd.get(prefix + "notes") || "").trim().slice(0, 500) || null,
      });
      savedMachines.push({ machineId: machine.id, ...saved });
    }
    // Do not save a submission that crossed the shift boundary while waiting for locks.
    if (new Date() >= window.end) throw new UserInputError("O turno mudou. Atualize a página antes de guardar.");
    return { general: savedGeneral, machines: savedMachines, finalized: savedGeneral.finalized && savedMachines.every(m => m.finalized) };
  });
  for (const path of ["/checkups", "/admin/checkups", "/dashboard"]) revalidatePath(path);
  return result;
}

// Server Actions hide thrown messages in production. Return known validation
// failures explicitly; unexpected failures get a reference, never SQL details.
export async function submitShiftCheckups(fd: FormData) {
  await requireOperationalUser();
  try { return {ok:true as const, data:await saveShiftCheckups(fd)}; }
  catch (error) {
    if(error instanceof UserInputError) return {ok:false as const,message:error.message};
    const reference=crypto.randomUUID();
    console.error("[checkups] Falha",reference,error);
    return {ok:false as const,message:`Não foi possível guardar as verificações. Confirme o estado antes de repetir. Referência: ${reference}`};
  }
}
