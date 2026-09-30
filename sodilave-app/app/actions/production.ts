"use server";

import {UserInputError} from "@/lib/action-error";
import {isCapMachine,isDualCavityMachine} from "@/lib/machine-icon";
import {assertPalletAvailable} from "@/lib/pallet-occupancy";
import { assertPastProductionEnabled } from "@/lib/operation-settings";
import { RecordStatus, TestMoment, TestResult, TestType } from "@/lib/db-types";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { formatLocalDateInput, getProductionEntryWindow, productionEditDeadline, getShiftWindow, getShiftWindowForDate, type ShiftCode } from "@/lib/shift";
import { readProductionPeriod } from "@/lib/production-period";
import { generateProductionLot } from "@/lib/lot";
import { assertMachineRunning } from "@/lib/active-machines";
import { saveRecordConfirmation, verifySecondWorker } from "@/lib/second-worker-confirmation";
import { getRecordedProductionStock, reconcileProductionStock, replaceRecordedProductionStock } from "@/lib/raw-material-stock";

const asNum = (value: FormDataEntryValue | null) => value === null || value === "" ? null : Number(value);
const validResults: TestResult[] = [TestResult.CONFORMING, TestResult.NON_CONFORMING, TestResult.NOT_PERFORMED];

const finiteInRange = (value: number | null, min: number, max: number, label: string, integer = false) => {
  if (value === null) return;
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new UserInputError(`${label} tem um valor inválido.`);
  }
};

type ExistingProduction = {
  recordOrigin?: string;
  capPackaging?:string|null;
  id: number;
  status: RecordStatus;
  operatorId: number;
  productionLot: string;
  startedAt: Date;
  shiftCode: string;
  productId: number;
  machineId: number;
  quantityProduced?: number | null;
  unitsPerPackageSnapshot?: number | null;
  productionUnitSnapshot?: string | null;
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
      throw new UserInputError("Preencha todos os testes antes de finalizar.");
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
      throw new UserInputError("Preencha todos os testes das duas cavidades antes de finalizar.");
    }
  }
  return rows;
}

export async function saveProduction(formData: FormData) {
  const user = await requireOperationalUser();
  const now=new Date();
  const intent = String(formData.get("intent") || "draft");
  const finalize = intent === "finalize";
  if (!["draft", "finalize"].includes(intent)) throw new UserInputError("Ação inválida.");

  const productionId = asNum(formData.get("productionId"));
  if (productionId !== null && (!Number.isInteger(productionId) || productionId <= 0)) {
    throw new UserInputError("Identificador da produção inválido.");
  }

  const historicalDate = String(formData.get("historicalDate") || "").trim();
  const historicalShiftRaw = String(formData.get("historicalShift") || "").trim();
  let historicalWindow: ReturnType<typeof getShiftWindowForDate> | null = null;
  if (historicalDate || historicalShiftRaw) {
    if (!historicalDate || !["A", "B", "C"].includes(historicalShiftRaw)) throw new UserInputError("Selecione uma data e um turno válidos.");
    historicalWindow = getShiftWindowForDate(historicalDate, historicalShiftRaw as ShiftCode);
    if (historicalWindow.end > new Date()) throw new UserInputError("Selecione um turno já terminado para registar produção passada.");
  }

  let existing: ExistingProduction | null = null;
  if (productionId) {
    existing = await db.production.findUnique({
      where: { id: productionId },
      select: { id: true, capPackaging:true, recordOrigin: true, status: true, operatorId: true, productionLot: true, startedAt: true, shiftCode: true, productId: true, machineId: true, quantityProduced: true, unitsPerPackageSnapshot: true, productionUnitSnapshot: true },
    });
    if (existing?.recordOrigin === "HISTORICAL_IMPORT") throw new UserInputError("Este registo pertence à importação histórica e não pode movimentar stock atual. Consulte-o em Importar histórico.");
    if (existing?.recordOrigin === "INITIAL_STOCK") throw new UserInputError("Edite o stock inicial no Mapa de Stock.");
    if (!existing) throw new UserInputError("A produção em aberto já não existe.");
    if (existing.status === RecordStatus.CANCELLED) throw new UserInputError("Esta produção foi cancelada.");
    if (existing.status === RecordStatus.FINALIZED && !finalize) {
      throw new UserInputError("Uma produção finalizada só pode ser corrigida através de ‘Finalizar e registar produção’.");
    }
    if (existing.status === RecordStatus.FINALIZED && user.role !== "ADMIN") {
      const window = getShiftWindow(existing.startedAt);
      if (now > productionEditDeadline(existing.startedAt)) throw new UserInputError("A tolerância de 30 minutos para corrigir esta produção terminou.");
    }
  }

  if (existing && historicalWindow && getShiftWindow(existing.startedAt).start.getTime() !== historicalWindow.start.getTime()) {
    throw new UserInputError("A data e o turno de uma produção já guardada não podem ser alterados.");
  }

  if (historicalWindow && !existing) await assertPastProductionEnabled();
  const periodToken=String(formData.get("productionPeriod")??"");
  const recordWindow=existing?getShiftWindow(existing.startedAt):historicalWindow??(periodToken?readProductionPeriod(periodToken,user.id,now):getProductionEntryWindow(now));
  const lateClosure=recordWindow.end<=now;

  const confirmationAt=historicalWindow?now:recordWindow.start;
  const secondWorker = finalize && user.role !== "ADMIN" ? await verifySecondWorker(formData, user.id, db, confirmationAt) : null;
  const machineId = asNum(formData.get("machineId"));
  const productId = asNum(formData.get("productId"));
  if (machineId === null || productId === null) {
    throw new UserInputError("Para guardar o rascunho, selecione pelo menos a máquina e o produto.");
  }
  if (!Number.isInteger(machineId) || machineId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    throw new UserInputError("Máquina e produto têm valores inválidos.");
  }

  if (existing && machineId !== existing.machineId) throw new UserInputError("A máquina de uma produção já guardada não pode ser alterada.");

  const machine=await db.machine.findFirst({where:{id:machineId,...(!historicalWindow&&!existing?{active:true}:{})}});
  if(!machine)throw new UserInputError("A máquina selecionada não está disponível.");
  const isCap=isCapMachine(machine.code),isMachine7=isDualCavityMachine(machine.code);
  const producedKg=isCap?asNum(formData.get("producedKg")):null;
  const productionColor=isCap?String(formData.get("productionColor")??"").trim().slice(0,80):null;
  const capPackaging=isCap?String(formData.get("capPackaging")??""):null;
  const capUnits=isCap?asNum(formData.get("capUnitsPerPackage")):null;
  finiteInRange(producedKg,0,999999,"Os kg de tampas produzidas");
  finiteInRange(capUnits,1,10000000,"As tampas por caixa/caixote",true);
  if(isCap&&capPackaging&&!["BOX","BIN"].includes(capPackaging))throw new UserInputError("Selecione caixas ou caixotes.");
  if(isCap&&finalize&&(producedKg===null||!productionColor||!capPackaging||capUnits===null))throw new UserInputError("Indique os kg produzidos, a cor, o tipo de embalagem e as tampas por caixa/caixote.");
  if(isCap&&existing?.status==="FINALIZED"&&(capUnits!==existing.unitsPerPackageSnapshot||capPackaging!==existing.productionUnitSnapshot))throw new UserInputError("O acondicionamento e as tampas por embalagem de uma produção finalizada não podem mudar porque já estão ligados ao stock. Use a correção administrativa para rever o registo.");
  const exceptionReason = String(formData.get("exceptionReason") || "").trim();
  const exceptionNotes = String(formData.get("exceptionNotes") || "").trim().slice(0, 500);
  const allowedExceptionReasons = ["MOULD_CHANGE", "RAW_MATERIAL_CHANGE", "OTHER"];
  if (exceptionReason && !allowedExceptionReasons.includes(exceptionReason)) throw new UserInputError("O motivo da produção adicional é inválido.");
  if (exceptionReason === "OTHER" && finalize && !exceptionNotes) throw new UserInputError("Explique o motivo da produção adicional.");

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
    if (!Number.isInteger(quantityPackages) || quantityPackages < 0) throw new UserInputError("Uma das quantidades de armazenamento é inválida.");
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
      if (finalize) throw new UserInputError("Um dos lotes selecionados é inválido.");
      continue;
    }
    if (percentage !== null) finiteInRange(percentage, 0, 100, "A percentagem");
    if (quantityKg !== null) finiteInRange(quantityKg, 0, 999999, "A quantidade de matéria-prima");
    materials.push({ rawMaterialLotId, percentage, quantityKg });
  }

  if (new Set(materials.map((row) => row.rawMaterialLotId)).size !== materials.length) {
    throw new UserInputError("O mesmo lote de matéria-prima não pode ser selecionado mais do que uma vez.");
  }

  if (finalize) {
    if (materials.length === 0) throw new UserInputError("Adicione pelo menos um lote de matéria-prima.");
    if (materials.some((row) => row.percentage === null || row.percentage < (isCap?0.01:5) || (!isCap&&row.percentage % 5 !== 0))) {
      throw new UserInputError(isCap?"Indique percentagens positivas para as matérias-primas e masterbatches.":"As percentagens devem variar de 5% em 5%.");
    }
    if (Math.abs(materials.reduce((sum, row) => sum + (row.percentage ?? 0), 0)-100)>0.001) {
      throw new UserInputError("A soma das percentagens da mistura tem de ser 100%.");
    }
    if (materials.some((row) => row.quantityKg === null || row.quantityKg <= 0)) {
      throw new UserInputError("Introduza a quantidade total de matéria-prima para calcular as quantidades da mistura.");
    }
    if (!isCap&&(initialWeightG === null || midWeightG === null)) throw new UserInputError("Preencha os pesos do início e do meio do turno.");
    if (quantityProduced === null) throw new UserInputError("Introduza a quantidade produzida.");
  }

  const firstFinalization = finalize && existing?.status !== RecordStatus.FINALIZED;
  if (storageUnlocated && !historicalWindow) {
    throw new UserInputError("A opção sem localização só pode ser usada em registos de produção passada.");
  }
  if (firstFinalization && quantityProduced !== null && quantityProduced > 0 && !storageUnlocated) {
    const allocatedPackages = [...storageAllocations.values()].reduce((sum, value) => sum + value, 0);
    if (!storageAllocations.size) throw new UserInputError("Indique no mapa onde a produção ficou armazenada.");
    if (allocatedPackages !== quantityProduced) {
      throw new UserInputError(`A localização do stock totaliza ${allocatedPackages} embalagem(ns), mas a produção tem ${quantityProduced}.`);
    }
  }

  const uniqueStorageLocationIds = [...storageAllocations.keys()];
  const storageLocationRows = uniqueStorageLocationIds.length
    ? await db.storageLocation.findMany({ where: { id: { in: uniqueStorageLocationIds }, active: true } })
    : [];
  if (storageLocationRows.length !== uniqueStorageLocationIds.length) throw new UserInputError("Uma das posições de armazenamento selecionadas já não está disponível.");
  if (new Set(storageLocationRows.map((row:any) => row.zoneType)).size > 1) {
    throw new UserInputError("A mesma produção deve ser armazenada apenas em estibas/montes ou apenas em paletes.");
  }

  const uniqueLotIds = [...new Set(materials.map((row) => row.rawMaterialLotId))];
  const lotRows = uniqueLotIds.length ? await db.rawMaterialLot.findMany({ where: { id: { in: uniqueLotIds } } }) : [];
  if (lotRows.length !== uniqueLotIds.length) throw new UserInputError("Um dos lotes selecionados já não existe.");

  const product = await db.product.findFirst({ where: { id: productId, active: true } });
  if (!machine || !product) throw new UserInputError("A máquina ou o produto selecionado já não está ativo.");
  if (existing?.status === RecordStatus.FINALIZED && productId !== existing.productId) {
    throw new UserInputError("O artigo de uma produção já finalizada não pode ser alterado porque já está ligado ao stock físico e à rastreabilidade.");
  }

  const productMachine = await db.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM ProductMachine WHERE productId=${productId} AND machineId=${machineId} LIMIT 1
  `;
  if (!productMachine.length) throw new UserInputError("O produto selecionado não está autorizado para esta máquina.");

  if (finalize && isMachine7 && (rightInitialWeightG === null || rightMidWeightG === null)) {
    throw new UserInputError("Preencha os pesos das cavidades esquerda e direita da máquina 7.");
  }
  if (finalize && !isCap && (!product.unitsPerPackage || product.unitsPerPackage <= 0)) {
    throw new UserInputError("Defina as unidades por embalagem deste produto antes de finalizar a produção.");
  }

  if (!historicalWindow && !lateClosure && (!existing || (user.role !== "ADMIN" && existing.status !== RecordStatus.FINALIZED))) {
    await assertMachineRunning(machineId);
  }

  const otherProductionsInShift = await db.production.count({
    where: {
      machineId, productId, recordOrigin:{in:["PRODUCTION","HISTORICAL_IMPORT"]},
      startedAt: { gte: recordWindow.start, lt: recordWindow.end },
      status: { not: RecordStatus.CANCELLED },
      ...(productionId ? { id: { not: productionId } } : {}),
    },
  });
  if (historicalWindow && otherProductionsInShift > 0) {
    throw new UserInputError("Já existe uma produção deste produto nesta máquina para a data e turno selecionados. O registo de produção passada não pode criar duplicações.");
  }
  if (finalize && otherProductionsInShift > 0 && !exceptionReason) {
    throw new UserInputError("Já existe uma produção deste produto nesta máquina neste turno. Indique o motivo da produção adicional.");
  }

  const leftTests = isCap ? [] : parseTests(formData, [
    { type: TestType.LEAK, moment: TestMoment.START, key: "leakStart" },
    { type: TestType.LEAK, moment: TestMoment.MID, key: "leakMid" },
    { type: TestType.DROP, moment: TestMoment.START, key: "dropStart" },
    { type: TestType.DROP, moment: TestMoment.MID, key: "dropMid" },
  ], finalize);
  const rightTests = isMachine7 ? parseRightTests(formData, finalize) : [];

  const shift = existing ? { code: existing.shiftCode } : {code:recordWindow.code};
  const status = finalize || existing?.status === RecordStatus.FINALIZED ? RecordStatus.FINALIZED : RecordStatus.DRAFT;

  const production = await db.$transaction(async (tx) => {
    // Lock before checking weekly/machine state and shift uniqueness. This also
    // protects against two tabs submitting the same normal production at once.
    await tx.query("SELECT id FROM Machine WHERE id=? FOR UPDATE", [machineId]);
    await tx.query("SELECT id FROM Product WHERE id IN (?,?) ORDER BY id FOR UPDATE", [productId,existing?.productId??productId]);
    if (!historicalWindow && !lateClosure && (!existing || (user.role !== "ADMIN" && existing.status !== RecordStatus.FINALIZED))) {
      const activeStartup = await tx.weeklyStartup.findFirst({ where: { status: RecordStatus.FINALIZED, shutdown: null } });
      const currentMachine = await tx.machine.findFirst({ where: { id: machineId, active: true, status: "RUNNING" } });
      if (!activeStartup || !currentMachine) throw new UserInputError("A máquina ou o ciclo semanal já não estão em funcionamento. Atualize a página.");
    }
    if(uniqueStorageLocationIds.length){
      const positions=await tx.query<any[]>(`SELECT id FROM StorageLocation WHERE id IN (${uniqueStorageLocationIds.map(()=>"?").join(",")}) AND active=1 ORDER BY id FOR UPDATE`,uniqueStorageLocationIds);
      if(positions.length!==uniqueStorageLocationIds.length)throw new UserInputError("Uma posição de stock foi removida. Atualize o formulário.");
    }
    const simultaneous = await tx.production.count({ where: {
      recordOrigin:{in:["PRODUCTION","HISTORICAL_IMPORT"]}, machineId, productId, startedAt: { gte: recordWindow.start, lt: recordWindow.end }, status: { not: RecordStatus.CANCELLED },
      ...(productionId ? { id: { not: productionId } } : {}),
    } });
    if (simultaneous > 0 && !exceptionReason) throw new UserInputError("Já existe uma produção deste produto nesta máquina neste turno. Atualize a página ou indique o motivo de uma produção adicional.");
    if (historicalWindow) {
      // Serialize past-shift inserts and the administrator's permission toggle.
      if(!existing)await assertPastProductionEnabled(tx, true);
      const duplicate = await tx.production.count({ where: {
        recordOrigin:{in:["PRODUCTION","HISTORICAL_IMPORT"]}, machineId, productId, startedAt: { gte: recordWindow.start, lt: recordWindow.end },
        status: { not: RecordStatus.CANCELLED }, ...(productionId ? { id: { not: productionId } } : {}),
      } });
      if (duplicate) throw new UserInputError("Já existe uma produção para este produto, máquina, dia e turno.");
    }
    let lockedExisting: ExistingProduction | null = existing;
    if (productionId) {
      const locked = await tx.query<ExistingProduction[]>(
        "SELECT id, status, operatorId, productionLot, startedAt, shiftCode, productId, machineId, quantityProduced, unitsPerPackageSnapshot, productionUnitSnapshot,capPackaging FROM Production WHERE id=? FOR UPDATE",
        [productionId],
      );
      lockedExisting = locked[0] ?? null;
      if (!lockedExisting) throw new UserInputError("A produção já não existe.");
      if (lockedExisting.status === RecordStatus.CANCELLED) throw new UserInputError("Esta produção foi cancelada.");
      if (lockedExisting.status !== existing?.status) throw new UserInputError("O estado da produção foi alterado por outro utilizador. Atualize a página antes de continuar.");
    }

    if(lockedExisting?.status===RecordStatus.FINALIZED && lockedExisting.productId!==productId)throw new UserInputError("Uma produção finalizada não pode mudar de produto. Corrija o lote no ecrã Lotes por produto.");
    if(isCap&&lockedExisting?.status==="FINALIZED"&&(capUnits!==lockedExisting.unitsPerPackageSnapshot||capPackaging!==lockedExisting.productionUnitSnapshot))throw new UserInputError("O acondicionamento deste registo mudou. Atualize a página.");
    if(isCap&&finalize&&Number(quantityProduced)>0&&!(Number(producedKg)>0))throw new UserInputError("Indique os kg de tampas produzidas.");
    const internalCode=lockedExisting && lockedExisting.productId===productId ? lockedExisting.productionLot : await generateProductionLot(productId,machine.code,shift.code,recordWindow.start,tx);
    if (lockedExisting?.status === RecordStatus.FINALIZED && quantityProduced !== null) {
      const [storageRows, dispatchRows] = await Promise.all([
        tx.query<{ total: number | string }[]>(
          "SELECT COALESCE(SUM(quantityPackages),0) AS total FROM ProductionStorageBalance WHERE productionId=?",
          [lockedExisting.id],
        ),
        tx.query<{ total: number | string }[]>(
          `SELECT COALESCE(SUM(line.quantityUnits),0) AS total
           FROM LotDispatchLine line
           INNER JOIN LotDispatch d ON d.id=line.lotDispatchId
           WHERE line.productionId=? AND d.cancelledAt IS NULL`,
          [lockedExisting.id],
        ),
      ]);
      const snapshotUnits = Number(lockedExisting.unitsPerPackageSnapshot ?? product.unitsPerPackage ?? 0);
      const dispatchedUnits = Number(dispatchRows[0]?.total ?? 0);
      if (snapshotUnits <= 0 || dispatchedUnits % snapshotUnits !== 0) {
        throw new UserInputError("A quantidade histórica deste lote não permite uma correção segura da produção.");
      }
      const accountedPackages = Number(storageRows[0]?.total ?? 0) + dispatchedUnits / snapshotUnits;
      if (quantityProduced < accountedPackages) {
        throw new UserInputError(`A produção não pode ser reduzida para ${quantityProduced}: já existem ${accountedPackages} embalagem(ns) localizadas ou expedidas.`);
      }
    }
    if (
      lockedExisting?.status === RecordStatus.FINALIZED &&
      user.role !== "ADMIN" &&
      quantityProduced !== null &&
      Number(lockedExisting.quantityProduced ?? 0) !== quantityProduced
    ) {
      throw new UserInputError("Depois de finalizada, a quantidade produzida só pode ser corrigida por um administrador porque está ligada ao mapa de stock.");
    }

    const previousStock = lockedExisting ? await getRecordedProductionStock(tx, lockedExisting.id) : [];
    if (status === RecordStatus.FINALIZED) {
      await reconcileProductionStock(tx, previousStock, materials);
    }

    const data = {
      machineId,
      productId,
      productionLot:internalCode,
      shiftCode: shift.code,
      status,
      initialWeightG:isCap?(existing?undefined:null):initialWeightG,
      midWeightG:isCap?(existing?undefined:null):midWeightG,
      producedKg,productionColor,capPackaging,
      quantityProduced,
      unitsPerPackageSnapshot: existing?.status === RecordStatus.FINALIZED ? undefined : (isCap?capUnits:(product.unitsPerPackage ?? null)),
      productionUnitSnapshot: existing?.status === RecordStatus.FINALIZED ? undefined : (isCap?capPackaging:(product.productionUnit ?? "BAG")),
      observations: String(formData.get("observations") || "").trim().slice(0, 500) || null,
      exceptionReason: otherProductionsInShift > 0 ? (exceptionReason || null) : null,
      exceptionNotes: otherProductionsInShift > 0 ? (exceptionNotes || null) : null,
      startedAt: lockedExisting ? undefined : historicalWindow || lateClosure ? recordWindow.start : now,
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
        await assertPalletAvailable(tx,locationId,saved.id);
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
            reason: historicalWindow ? "Localização registada na produção passada." : "Entrada em stock após finalização da produção.",
          },
        });
      }
    }

    // Keep historical labels on unchanged legacy records. New lots use one generated code.
    if(lockedExisting && lockedExisting.productId!==productId) await tx.execute("DELETE FROM ProductionLotAssociation WHERE productionId=?",[saved.id]);

    await tx.productionMaterial.deleteMany({ where: { productionId: saved.id } });
    if (materials.length) {
      await tx.productionMaterial.createMany({
        data: materials.map((row) => ({ productionId: saved.id, ...row })),
      });
    }

    if(!isCap)await tx.qualityTest.deleteMany({ where: { productionId: saved.id } });
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
      await saveRecordConfirmation("Production", saved.id, secondWorker, user.id, tx, confirmationAt);
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
          producedKg,productionColor,capPackaging,capUnits,
          internalCode,
          secondWorkerId: secondWorker?.id ?? null,
          secondWorkerName: secondWorker?.name ?? null,
          stockReconciled: status === RecordStatus.FINALIZED,
          historicalDate: historicalWindow ? formatLocalDateInput(historicalWindow.start) : null,
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
    ok: true as const,
    id: production.id,
    lot: production.productionLot,
    finalized: finalize,
  };
}

export async function submitProduction(fd:FormData){
  await requireOperationalUser();
  try{return await saveProduction(fd);}catch(error){if(error instanceof UserInputError)return {ok:false as const,message:error.message};const reference=crypto.randomUUID();console.error("[production]",reference,error);return {ok:false as const,message:`Não foi possível guardar. Confirme o estado antes de repetir. Referência: ${reference}`};}
}
