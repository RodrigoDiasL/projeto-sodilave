"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getShift, getShiftWindow } from "@/lib/shift";
import { generateProductionLot } from "@/lib/lot";
import { RecordStatus, TestMoment, TestResult, TestType } from "@prisma/client";
import { assertMachineRunning } from "@/lib/active-machines";

const asNum = (v: FormDataEntryValue | null) => v === null || v === "" ? null : Number(v);
const finiteInRange = (value: number | null, min: number, max: number, label: string, integer = false) => {
  if (value === null) return;
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label} tem um valor inválido.`);
};

export async function saveProduction(formData: FormData) {
  const user = await requireUser();
  const intent = String(formData.get("intent") || "draft");
  const finalize = intent === "finalize";
  if (!["draft", "finalize"].includes(intent)) throw new Error("Ação inválida.");

  const productionId = asNum(formData.get("productionId"));
  if (productionId !== null && (!Number.isInteger(productionId) || productionId <= 0)) throw new Error("Identificador da produção inválido.");
  const machineId = asNum(formData.get("machineId"));
  const productId = asNum(formData.get("productId"));
  if (machineId === null || productId === null) throw new Error("Para guardar o rascunho, selecione pelo menos a máquina e o produto.");
  if (!Number.isInteger(machineId) || machineId <= 0 || !Number.isInteger(productId) || productId <= 0) throw new Error("Máquina e produto têm valores inválidos.");

  const exceptionReason = String(formData.get("exceptionReason") || "").trim();
  const exceptionNotes = String(formData.get("exceptionNotes") || "").trim().slice(0, 500);
  const allowedExceptionReasons = ["MOULD_CHANGE", "RAW_MATERIAL_CHANGE", "OTHER"];
  if (exceptionReason && !allowedExceptionReasons.includes(exceptionReason)) throw new Error("O motivo da produção adicional é inválido.");
  if (exceptionReason === "OTHER" && finalize && !exceptionNotes) throw new Error("Explique o motivo da produção adicional.");

  const initialWeightG = asNum(formData.get("initialWeightG"));
  const midWeightG = asNum(formData.get("midWeightG"));
  const rightInitialWeightG = asNum(formData.get("rightInitialWeightG"));
  const rightMidWeightG = asNum(formData.get("rightMidWeightG"));
  const quantityProduced = asNum(formData.get("quantityProduced"));
  finiteInRange(initialWeightG, 1, 100000, "O peso inicial da cavidade esquerda", true);
  finiteInRange(midWeightG, 1, 100000, "O peso intermédio da cavidade esquerda", true);
  finiteInRange(rightInitialWeightG, 1, 100000, "O peso inicial da cavidade direita", true);
  finiteInRange(rightMidWeightG, 1, 100000, "O peso intermédio da cavidade direita", true);
  finiteInRange(quantityProduced, 0, 10000000, "A quantidade produzida", true);

  const materials: { rawMaterialLotId: number; percentage: number | null; quantityKg: number | null }[] = [];
  for (let i = 0; i < 8; i++) {
    const rawMaterialLotId = asNum(formData.get(`materialLotId_${i}`));
    const percentage = asNum(formData.get(`percentage_${i}`));
    const quantityKg = asNum(formData.get(`quantityKg_${i}`));
    if (!rawMaterialLotId) continue;
    if (!Number.isInteger(rawMaterialLotId) || rawMaterialLotId <= 0) {
      if (finalize) throw new Error("Um dos lotes selecionados é inválido.");
      continue;
    }
    if (percentage !== null) finiteInRange(percentage, 0, 100, "A percentagem");
    if (quantityKg !== null) finiteInRange(quantityKg, 0, 999999, "A quantidade de matéria-prima");
    materials.push({ rawMaterialLotId, percentage, quantityKg });
  }

  if (finalize) {
    if (materials.length === 0) throw new Error("Adicione pelo menos um lote de matéria-prima.");
    if (materials.some((row) => row.percentage === null || row.percentage! < 5 || row.percentage! % 5 !== 0)) throw new Error("As percentagens devem variar de 5% em 5%.");
    if (materials.reduce((sum, row) => sum + (row.percentage ?? 0), 0) !== 100) throw new Error("A soma das percentagens da mistura tem de ser 100%.");
    if (materials.some((row) => row.quantityKg === null || row.quantityKg! <= 0)) throw new Error("Introduza a quantidade total de matéria-prima para calcular as quantidades da mistura.");
    if (initialWeightG === null || midWeightG === null) throw new Error("Preencha os pesos do início e do meio do turno.");
    if (quantityProduced === null) throw new Error("Introduza a quantidade produzida.");
  }

  const lotRows = materials.length ? await db.rawMaterialLot.findMany({ where: { id: { in: materials.map((row) => row.rawMaterialLotId) }, status: "ACTIVE" } }) : [];
  if (finalize && lotRows.length !== materials.length) throw new Error("Um dos lotes selecionados já não está disponível.");
  for (const material of materials) {
    const lotRow = lotRows.find((lot) => lot.id === material.rawMaterialLotId);
    if (finalize && lotRow && material.quantityKg !== null && material.quantityKg > Number(lotRow.quantityAvailable)) throw new Error(`A quantidade excede o stock disponível do lote ${lotRow.supplierLot}.`);
  }

  const machine = await db.machine.findFirst({ where: { id: machineId, active: true } });
  const product = await db.product.findFirst({ where: { id: productId, active: true } });
  if (!machine || !product) throw new Error("A máquina ou o produto selecionado já não está ativo.");
  const isMachine7 = machine.code === "7";
  if (finalize && isMachine7 && (rightInitialWeightG === null || rightMidWeightG === null)) throw new Error("Preencha os pesos das cavidades esquerda e direita da máquina 7.");
  if (finalize && (!product.unitsPerPackage || product.unitsPerPackage <= 0)) throw new Error("Defina as unidades por embalagem deste produto antes de finalizar a produção.");
  await assertMachineRunning(machineId);

  const shiftWindow = getShiftWindow();
  const otherProductionsInShift = await db.production.count({
    where: {
      machineId,
      startedAt: { gte: shiftWindow.start, lt: shiftWindow.end },
      status: { not: RecordStatus.CANCELLED },
      ...(productionId ? { id: { not: productionId } } : {}),
    },
  });
  if (finalize && otherProductionsInShift > 0 && !exceptionReason) throw new Error("Já existe uma produção desta máquina neste turno. Indique o motivo da produção adicional.");

  let existing: { id: number; status: RecordStatus; operatorId: number; productionLot: string; startedAt: Date } | null = null;
  if (productionId) {
    existing = await db.production.findUnique({ where: { id: productionId }, select: { id: true, status: true, operatorId: true, productionLot: true, startedAt: true } });
    if (!existing) throw new Error("A produção em aberto já não existe.");
    if (existing.status === RecordStatus.CANCELLED) throw new Error("Esta produção foi cancelada.");
    if (existing.status === RecordStatus.FINALIZED) {
      const window = getShiftWindow(existing.startedAt);
      if (new Date() >= window.end) throw new Error("Esta produção só podia ser alterada até ao fim do turno em que foi registada.");
    }
  }

  const shift = getShift();
  const lot = existing?.productionLot ?? await generateProductionLot(machine.code, shift.code);
  const status = finalize || existing?.status === RecordStatus.FINALIZED ? RecordStatus.FINALIZED : RecordStatus.DRAFT;
  const data = {
    machineId, productId, shiftCode: shift.code, status,
    initialWeightG, midWeightG, quantityProduced,
    observations: String(formData.get("observations") || "").trim().slice(0, 500) || null,
    exceptionReason: otherProductionsInShift > 0 ? (exceptionReason || null) : null,
    exceptionNotes: otherProductionsInShift > 0 ? (exceptionNotes || null) : null,
    finalizedAt: status === RecordStatus.FINALIZED ? (existing?.status === RecordStatus.FINALIZED ? undefined : new Date()) : null,
  };
  const production = existing
    ? await db.production.update({ where: { id: existing.id }, data })
    : await db.production.create({ data: { ...data, operatorId: user.id, productionLot: lot } });

  await db.productionMaterial.deleteMany({ where: { productionId: production.id } });
  if (materials.length) await db.productionMaterial.createMany({ data: materials.map((row) => ({ productionId: production.id, ...row })) });

  await db.qualityTest.deleteMany({ where: { productionId: production.id } });
  const leftTests: [TestType, TestMoment, string][] = [
    [TestType.LEAK, TestMoment.START, "leakStart"], [TestType.LEAK, TestMoment.MID, "leakMid"],
    [TestType.DROP, TestMoment.START, "dropStart"], [TestType.DROP, TestMoment.MID, "dropMid"],
  ];
  const validResults = [TestResult.CONFORMING, TestResult.NON_CONFORMING, TestResult.NOT_PERFORMED];
  for (const [type, moment, key] of leftTests) {
    const value = String(formData.get(key) || "");
    if (value && validResults.includes(value as TestResult)) await db.qualityTest.create({ data: { productionId: production.id, type, moment, result: value as TestResult } });
    else if (finalize) throw new Error("Preencha todos os testes antes de finalizar.");
  }

  if (isMachine7) {
    await db.$executeRaw`INSERT INTO ProductionCavityData (productionId, rightInitialWeightG, rightMidWeightG) VALUES (${production.id}, ${rightInitialWeightG}, ${rightMidWeightG}) ON DUPLICATE KEY UPDATE rightInitialWeightG = VALUES(rightInitialWeightG), rightMidWeightG = VALUES(rightMidWeightG)`;
    await db.$executeRaw`DELETE FROM ProductionCavityTest WHERE productionId = ${production.id}`;
    const rightTests: [string, string, string][] = [["LEAK","START","leakStartRight"],["LEAK","MID","leakMidRight"],["DROP","START","dropStartRight"],["DROP","MID","dropMidRight"]];
    for (const [type, moment, key] of rightTests) {
      const value = String(formData.get(key) || "");
      if (value && validResults.includes(value as TestResult)) await db.$executeRaw`INSERT INTO ProductionCavityTest (productionId, cavity, type, moment, result) VALUES (${production.id}, 'RIGHT', ${type}, ${moment}, ${value})`;
      else if (finalize) throw new Error("Preencha todos os testes das duas cavidades antes de finalizar.");
    }
  } else {
    await db.$executeRaw`DELETE FROM ProductionCavityData WHERE productionId = ${production.id}`;
    await db.$executeRaw`DELETE FROM ProductionCavityTest WHERE productionId = ${production.id}`;
  }

  const action = finalize ? "FINALIZE" : existing ? "EDIT" : "CREATE";
  await db.auditLog.create({ data: { userId: user.id, action, entity: "Production", entityId: String(production.id), details: { status } } });
  revalidatePath("/production"); revalidatePath("/admin/productions");
  return { ok: true, id: production.id, lot: production.productionLot, finalized: finalize };
}
