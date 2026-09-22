"use server";

import { RecordStatus, TestMoment, TestResult, TestType } from "@/lib/db-types";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { getShift, getShiftWindow, getShiftWindowForDate, type ShiftCode } from "@/lib/shift";
import { generateProductionLot, getActiveCommercialLotForProduct, validateCommercialLotMixture } from "@/lib/lot";
import { assertMachineRunning } from "@/lib/active-machines";
import { saveRecordConfirmation, verifySecondWorker } from "@/lib/second-worker-confirmation";
import { getRecordedProductionStock, reconcileProductionStock, replaceRecordedProductionStock } from "@/lib/raw-material-stock";

const asNum = (value: FormDataEntryValue | null) => value === null || value === "" ? null : Number(value);
const validResults: TestResult[] = [TestResult.CONFORMING, TestResult.NON_CONFORMING, TestResult.NOT_PERFORMED];

const finiteInRange = (value: number | null, min: number, max: number, label: string, integer = false) => {
  if (value === null) return;
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} tem um valor inválido.`);
  }
};

type ExistingProduction = {
  id: number;
  status: RecordStatus;
  operatorId: number;
  productionLot: string;
  startedAt: Date;
  shiftCode: string;
  productId: number;
};

type TestInput = { type: TestType; moment: TestMoment; key: string };
type ParsedTest = { type: TestType; moment: TestMoment; result: TestResult };
type ParsedRightTest = { type: string; moment: string; result: TestResult };

function parseTests(formData: FormData, inputs: TestInput[], required: boolean) {
  const rows: ParsedTest[] = [];
  for (const input of inputs) {
    const value = String(formData.get(input.key) || "");
    if (validResults.includes(value as TestResult)) {
      rows.push({ type: input.type, moment: input.moment, result: value as TestResult });
    } else if (required) {
      throw new Error("Preencha todos os testes antes de finalizar.");
    }
  }
  return rows;
}

function parseRightTests(formData: FormData, required: boolean) {
  const inputs = [
    { type: "LEAK", moment: "START", key: "leakStartRight" },
    { type: "LEAK", moment: "MID", key: "leakMidRight" },
    { type: "DROP", moment: "START", key: "dropStartRight" },
    { type: "DROP", moment: "MID", key: "dropMidRight" },
  ];
  const rows: ParsedRightTest[] = [];
  for (const input of inputs) {
    const value = String(formData.get(input.key) || "");
    if (validResults.includes(value as TestResult)) {
      rows.push({ type: input.type, moment: input.moment, result: value as TestResult });
    } else if (required) {
      throw new Error("Preencha todos os testes das duas cavidades antes de finalizar.");
    }
  }
  return rows;
}

export async function saveProduction(formData: FormData) {
  const user = await requireOperationalUser();
  const intent = String(formData.get("intent") || "draft");
  const finalize = intent === "finalize";
  if (!["draft", "finalize"].includes(intent)) throw new Error("Ação inválida.");

  const productionId = asNum(formData.get("productionId"));
  if (productionId !== null && (!Number.isInteger(productionId) || productionId <= 0)) {
    throw new Error("Identificador da produção inválido.");
  }

  const historicalDate = String(formData.get("historicalDate") || "").trim();
  const historicalShiftRaw = String(formData.get("historicalShift") || "").trim();
  let historicalWindow: ReturnType<typeof getShiftWindowForDate> | null = null;
  if (historicalDate || historicalShiftRaw) {
    if (user.role !== "ADMIN") throw new Error("Apenas administradores podem registar produções de outras datas.");
    if (!historicalDate || !["A", "B", "C"].includes(historicalShiftRaw)) throw new Error("Selecione uma data e um turno válidos.");
    historicalWindow = getShiftWindowForDate(historicalDate, historicalShiftRaw as ShiftCode);
    if (historicalWindow.start > new Date()) throw new Error("Não é possível registar uma produção num turno futuro.");
  }

  let existing: ExistingProduction | null = null;
  if (productionId) {
    existing = await db.production.findUnique({
      where: { id: productionId },
      select: { id: true, status: true, operatorId: true, productionLot: true, startedAt: true, shiftCode: true, productId: true },
    });
    if (!existing) throw new Error("A produção em aberto já não existe.");
    if (existing.status === RecordStatus.CANCELLED) throw new Error("Esta produção foi cancelada.");
    if (existing.status === RecordStatus.FINALIZED && !finalize) {
      throw new Error("Uma produção finalizada só pode ser corrigida através de ‘Finalizar e registar produção’.");
    }
    if (existing.status === RecordStatus.FINALIZED && user.role !== "ADMIN") {
      const window = getShiftWindow(existing.startedAt);
      if (new Date() >= window.end) throw new Error("Esta produção só podia ser alterada até ao fim do turno em que foi registada.");
    }
  }

  const secondWorker = finalize && user.role !== "ADMIN" ? await verifySecondWorker(formData, user.id) : null;
  const machineId = asNum(formData.get("machineId"));
  const productId = asNum(formData.get("productId"));
  if (machineId === null || productId === null) {
    throw new Error("Para guardar o rascunho, selecione pelo menos a máquina e o produto.");
  }
  if (!Number.isInteger(machineId) || machineId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    throw new Error("Máquina e produto têm valores inválidos.");
  }

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
  const storageUnlocated = formData.get("storageUnlocated") === "on";
  const storageAllocations = new Map<number, number>();
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("storage_location_")) continue;
    const locationId = Number(key.slice("storage_location_".length));
    const quantityPackages = Number(rawValue || 0);
    if (!Number.isInteger(locationId) || locationId <= 0) continue;
    if (!Number.isInteger(quantityPackages) || quantityPackages < 0) throw new Error("Uma das quantidades de armazenamento é inválida.");
    if (quantityPackages > 0) storageAllocations.set(locationId, quantityPackages);
  }
  finiteInRange(initialWeightG, 1, 100000, "O peso inicial da cavidade esquerda", true);
  finiteInRange(midWeightG, 1, 100000, "O peso intermédio da cavidade esquerda", true);
  finiteInRange(rightInitialWeightG, 1, 100000, "O peso inicial da cavidade direita", true);
  finiteInRange(rightMidWeightG, 1, 100000, "O peso intermédio da cavidade direita", true);
  finiteInRange(quantityProduced, 0, 10000000, "A quantidade produzida", true);

  const materials: { rawMaterialLotId: number; percentage: number | null; quantityKg: number | null }[] = [];
  for (let index = 0; index < 8; index++) {
    const rawMaterialLotId = asNum(formData.get(`materialLotId_${index}`));
    const percentage = asNum(formData.get(`percentage_${index}`));
    const quantityKg = asNum(formData.get(`quantityKg_${index}`));
    if (!rawMaterialLotId) continue;
    if (!Number.isInteger(rawMaterialLotId) || rawMaterialLotId <= 0) {
      if (finalize) throw new Error("Um dos lotes selecionados é inválido.");
      continue;
    }
    if (percentage !== null) finiteInRange(percentage, 0, 100, "A percentagem");
    if (quantityKg !== null) finiteInRange(quantityKg, 0, 999999, "A quantidade de matéria-prima");
    materials.push({ rawMaterialLotId, percentage, quantityKg });
  }

  if (new Set(materials.map((row) => row.rawMaterialLotId)).size !== materials.length) {
    throw new Error("O mesmo lote de matéria-prima não pode ser selecionado mais do que uma vez.");
  }

  if (finalize) {
    if (materials.length === 0) throw new Error("Adicione pelo menos um lote de matéria-prima.");
    if (materials.some((row) => row.percentage === null || row.percentage < 5 || row.percentage % 5 !== 0)) {
      throw new Error("As percentagens devem variar de 5% em 5%.");
    }
    if (materials.reduce((sum, row) => sum + (row.percentage ?? 0), 0) !== 100) {
      throw new Error("A soma das percentagens da mistura tem de ser 100%.");
    }
    if (materials.some((row) => row.quantityKg === null || row.quantityKg <= 0)) {
      throw new Error("Introduza a quantidade total de matéria-prima para calcular as quantidades da mistura.");
    }
    if (initialWeightG === null || midWeightG === null) throw new Error("Preencha os pesos do início e do meio do turno.");
    if (quantityProduced === null) throw new Error("Introduza a quantidade produzida.");
  }

  const firstFinalization = finalize && existing?.status !== RecordStatus.FINALIZED;
  if (storageUnlocated && !historicalWindow) {
    throw new Error("A opção sem localização só pode ser usada em registos históricos de administrador.");
  }
  if (firstFinalization && quantityProduced !== null && quantityProduced > 0 && !storageUnlocated) {
    const allocatedPackages = [...storageAllocations.values()].reduce((sum, value) => sum + value, 0);
    if (!storageAllocations.size) throw new Error("Indique no mapa onde a produção ficou armazenada.");
    if (allocatedPackages !== quantityProduced) {
      throw new Error(`A localização do stock totaliza ${allocatedPackages} embalagem(ns), mas a produção tem ${quantityProduced}.`);
    }
  }

  const uniqueStorageLocationIds = [...storageAllocations.keys()];
  const storageLocationRows = uniqueStorageLocationIds.length
    ? await db.storageLocation.findMany({ where: { id: { in: uniqueStorageLocationIds }, active: true } })
    : [];
  if (storageLocationRows.length !== uniqueStorageLocationIds.length) throw new Error("Uma das posições de armazenamento selecionadas já não está disponível.");
  if (new Set(storageLocationRows.map((row:any) => row.zoneType)).size > 1) {
    throw new Error("A mesma produção deve ser armazenada apenas em estibas/montes ou apenas em paletes.");
  }

  const uniqueLotIds = [...new Set(materials.map((row) => row.rawMaterialLotId))];
  const lotRows = uniqueLotIds.length ? await db.rawMaterialLot.findMany({ where: { id: { in: uniqueLotIds } } }) : [];
  if (lotRows.length !== uniqueLotIds.length) throw new Error("Um dos lotes selecionados já não existe.");

  const machine = await db.machine.findFirst({ where: { id: machineId, active: true } });
  const product = await db.product.findFirst({ where: { id: productId, active: true } });
  if (!machine || !product) throw new Error("A máquina ou o produto selecionado já não está ativo.");
  const productMachine = await db.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM ProductMachine WHERE productId=${productId} AND machineId=${machineId} LIMIT 1
  `;
  if (!productMachine.length) throw new Error("O produto selecionado não está autorizado para esta máquina.");

  const isMachine7 = machine.code === "7";
  if (finalize && isMachine7 && (rightInitialWeightG === null || rightMidWeightG === null)) {
    throw new Error("Preencha os pesos das cavidades esquerda e direita da máquina 7.");
  }
  if (finalize && (!product.unitsPerPackage || product.unitsPerPackage <= 0)) {
    throw new Error("Defina as unidades por embalagem deste produto antes de finalizar a produção.");
  }

  if (!historicalWindow && (!existing || (user.role !== "ADMIN" && existing.status !== RecordStatus.FINALIZED))) {
    await assertMachineRunning(machineId);
  }

  const previousAssociation = productionId ? await db.$queryRaw<{ commercialLotId: number; code: string; productId: number }[]>`
    SELECT pla.commercialLotId, cl.code, cl.productId
    FROM ProductionLotAssociation pla
    INNER JOIN CommercialLot cl ON cl.id=pla.commercialLotId
    WHERE pla.productionId=${productionId}
    LIMIT 1
  ` : [];
  const associatedLot = previousAssociation[0];
  const commercialLot = associatedLot && associatedLot.productId === productId
    ? { id: associatedLot.commercialLotId, code: associatedLot.code }
    : await getActiveCommercialLotForProduct(productId);

  if (finalize && !commercialLot) {
    throw new Error("Não existe um lote comercial ativo para este produto. Peça a um administrador ou ao responsável de produção para o criar.");
  }
  if (finalize && commercialLot && !(await validateCommercialLotMixture(commercialLot.id, materials))) {
    throw new Error(`A mistura introduzida não corresponde à mistura definida no lote comercial ${commercialLot.code}.`);
  }

  const recordWindow = existing ? getShiftWindow(existing.startedAt) : historicalWindow ?? getShiftWindow();
  const otherProductionsInShift = await db.production.count({
    where: {
      machineId,
      startedAt: { gte: recordWindow.start, lt: recordWindow.end },
      status: { not: RecordStatus.CANCELLED },
      ...(productionId ? { id: { not: productionId } } : {}),
    },
  });
  if (historicalWindow && otherProductionsInShift > 0) {
    throw new Error("Já existe uma produção desta máquina para a data e turno selecionados. O registo histórico não pode criar duplicações.");
  }
  if (finalize && otherProductionsInShift > 0 && !exceptionReason) {
    throw new Error("Já existe uma produção desta máquina neste turno. Indique o motivo da produção adicional.");
  }

  const leftTests = parseTests(formData, [
    { type: TestType.LEAK, moment: TestMoment.START, key: "leakStart" },
    { type: TestType.LEAK, moment: TestMoment.MID, key: "leakMid" },
    { type: TestType.DROP, moment: TestMoment.START, key: "dropStart" },
    { type: TestType.DROP, moment: TestMoment.MID, key: "dropMid" },
  ], finalize);
  const rightTests = isMachine7 ? parseRightTests(formData, finalize) : [];

  const shift = existing ? { code: existing.shiftCode } : historicalWindow ? { code: historicalWindow.code } : getShift();
  const internalCode = existing?.productionLot ?? await generateProductionLot(machine.code, shift.code, recordWindow.start);
  const status = finalize || existing?.status === RecordStatus.FINALIZED ? RecordStatus.FINALIZED : RecordStatus.DRAFT;

  const production = await db.$transaction(async (tx) => {
    let lockedExisting: ExistingProduction | null = existing;
    if (productionId) {
      const locked = await tx.query<ExistingProduction[]>(
        "SELECT id, status, operatorId, productionLot, startedAt, shiftCode, productId FROM Production WHERE id=? FOR UPDATE",
        [productionId],
      );
      lockedExisting = locked[0] ?? null;
      if (!lockedExisting) throw new Error("A produção já não existe.");
      if (lockedExisting.status === RecordStatus.CANCELLED) throw new Error("Esta produção foi cancelada.");
    }

    const previousStock = lockedExisting ? await getRecordedProductionStock(tx, lockedExisting.id) : [];
    if (status === RecordStatus.FINALIZED) {
      await reconcileProductionStock(tx, previousStock, materials);
    }

    const data = {
      machineId,
      productId,
      shiftCode: shift.code,
      status,
      initialWeightG,
      midWeightG,
      quantityProduced,
      unitsPerPackageSnapshot: product.unitsPerPackage ?? null,
      productionUnitSnapshot: product.productionUnit ?? "BAG",
      observations: String(formData.get("observations") || "").trim().slice(0, 500) || null,
      exceptionReason: otherProductionsInShift > 0 ? (exceptionReason || null) : null,
      exceptionNotes: otherProductionsInShift > 0 ? (exceptionNotes || null) : null,
      startedAt: lockedExisting ? undefined : historicalWindow?.start,
      finalizedAt: status === RecordStatus.FINALIZED
        ? (lockedExisting?.status === RecordStatus.FINALIZED ? undefined : new Date())
        : null,
    };

    const saved = lockedExisting
      ? await tx.production.update({ where: { id: lockedExisting.id }, data })
      : await tx.production.create({ data: { ...data, operatorId: user.id, productionLot: internalCode } });

    const becameFinalized = status === RecordStatus.FINALIZED && lockedExisting?.status !== RecordStatus.FINALIZED;
    if (becameFinalized && !storageUnlocated && quantityProduced && quantityProduced > 0) {
      await tx.productionStorageBalance.deleteMany({ where: { productionId: saved.id } });
      for (const [locationId, quantityPackages] of storageAllocations) {
        await tx.productionStorageBalance.create({
          data: { productionId: saved.id, locationId, quantityPackages },
        });
        await tx.productionStorageMovement.create({
          data: {
            productionId: saved.id,
            movementType: "ENTRY",
            fromLocationId: null,
            toLocationId: locationId,
            quantityPackages,
            lotDispatchId: null,
            createdById: user.id,
            reason: historicalWindow ? "Localização registada na introdução histórica da produção." : "Entrada em stock após finalização da produção.",
          },
        });
      }
    }

    if (commercialLot) {
      const labelCode = `${commercialLot.code} / ${internalCode}`;
      await tx.$executeRaw`
        INSERT INTO ProductionLotAssociation (productionId, commercialLotId, internalCode, labelCode)
        VALUES (${saved.id}, ${commercialLot.id}, ${internalCode}, ${labelCode})
        ON DUPLICATE KEY UPDATE commercialLotId=VALUES(commercialLotId), internalCode=VALUES(internalCode), labelCode=VALUES(labelCode)
      `;
    } else {
      await tx.$executeRaw`DELETE FROM ProductionLotAssociation WHERE productionId=${saved.id}`;
    }

    await tx.productionMaterial.deleteMany({ where: { productionId: saved.id } });
    if (materials.length) {
      await tx.productionMaterial.createMany({
        data: materials.map((row) => ({ productionId: saved.id, ...row })),
      });
    }

    await tx.qualityTest.deleteMany({ where: { productionId: saved.id } });
    if (leftTests.length) {
      await tx.qualityTest.createMany({
        data: leftTests.map((row) => ({ productionId: saved.id, ...row })),
      });
    }

    if (isMachine7) {
      await tx.$executeRaw`
        INSERT INTO ProductionCavityData (productionId, rightInitialWeightG, rightMidWeightG)
        VALUES (${saved.id}, ${rightInitialWeightG}, ${rightMidWeightG})
        ON DUPLICATE KEY UPDATE rightInitialWeightG=VALUES(rightInitialWeightG), rightMidWeightG=VALUES(rightMidWeightG)
      `;
      await tx.$executeRaw`DELETE FROM ProductionCavityTest WHERE productionId=${saved.id}`;
      for (const row of rightTests) {
        await tx.$executeRaw`
          INSERT INTO ProductionCavityTest (productionId, cavity, type, moment, result)
          VALUES (${saved.id}, 'RIGHT', ${row.type}, ${row.moment}, ${row.result})
        `;
      }
    } else {
      await tx.$executeRaw`DELETE FROM ProductionCavityData WHERE productionId=${saved.id}`;
      await tx.$executeRaw`DELETE FROM ProductionCavityTest WHERE productionId=${saved.id}`;
    }

    if (status === RecordStatus.FINALIZED) {
      await replaceRecordedProductionStock(tx, saved.id, materials);
    }

    if (finalize && secondWorker) {
      await saveRecordConfirmation("Production", saved.id, secondWorker.id, tx);
    }

    const action = finalize ? "FINALIZE" : lockedExisting ? "EDIT" : "CREATE";
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action,
        entity: "Production",
        entityId: String(saved.id),
        details: {
          status,
          commercialLot: commercialLot?.code ?? null,
          internalCode,
          secondWorkerId: secondWorker?.id ?? null,
          secondWorkerName: secondWorker?.name ?? null,
          stockReconciled: status === RecordStatus.FINALIZED,
          historicalDate: historicalWindow ? historicalDate : null,
          historicalShift: historicalWindow?.code ?? null,
          storageUnlocated: firstFinalization ? storageUnlocated : null,
          storageAllocations: firstFinalization ? [...storageAllocations.entries()].map(([locationId, quantityPackages]) => ({ locationId, quantityPackages })) : null,
        },
      },
    });

    return saved;
  });

  revalidatePath("/production");
  revalidatePath("/admin/productions");
  revalidatePath("/admin/raw-material-lots");
  revalidatePath("/commercial-lots");
  revalidatePath("/stock-map");
  revalidatePath("/lot-dispatch");
  revalidatePath("/traceability");
  return {
    ok: true,
    id: production.id,
    lot: commercialLot ? `${commercialLot.code} / ${internalCode}` : internalCode,
    finalized: finalize,
  };
}
