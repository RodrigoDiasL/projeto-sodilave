"use server";

import {assertPalletAvailable} from "@/lib/pallet-occupancy";
import { UserInputError } from "@/lib/action-error";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db, type DbTransaction } from "@/lib/db";

const positiveId = (fd: FormData, key: string) => {
  const value = Number(fd.get(key) || 0);
  if (!Number.isInteger(value) || value <= 0) throw new UserInputError("Identificador inválido.");
  return value;
};

const reason = (fd: FormData) => {
  const value = String(fd.get("reason") || "").trim().slice(0, 500);
  if (!value) throw new UserInputError("Indique o motivo da correção.");
  return value;
};

async function getProductionCapacity(tx: DbTransaction, productionId: number) {
  const rows = await tx.query<any[]>(
    `SELECT
       p.id,
       p.status,
       p.recordOrigin,
       COALESCE(p.quantityProduced,0) AS producedPackages,
       COALESCE(p.unitsPerPackageSnapshot,pr.unitsPerPackage,0) AS unitsPerPackage,
       COALESCE(pla.labelCode,p.productionLot) AS lotCode
     FROM Production p
     INNER JOIN Product pr ON pr.id=p.productId
     LEFT JOIN ProductionLotAssociation pla ON pla.productionId=p.id
     WHERE p.id=?
     FOR UPDATE`,
    [productionId],
  );
  const production = rows[0];
  if (!production) throw new UserInputError("O lote de produção já não existe.");
  if (production.recordOrigin === "HISTORICAL_IMPORT") throw new UserInputError("O histórico importado não cria stock físico.");
  if (production.status !== "FINALIZED") throw new UserInputError("Só é possível movimentar stock de produções finalizadas.");

  const unitsPerPackage = Number(production.unitsPerPackage);
  const producedPackages = Number(production.producedPackages);
  if (!Number.isInteger(unitsPerPackage) || unitsPerPackage <= 0 || !Number.isInteger(producedPackages) || producedPackages < 0) {
    throw new UserInputError("O lote não tem uma quantidade de produção válida.");
  }

  const dispatched = await tx.query<any[]>(
    `SELECT COALESCE(SUM(line.quantityUnits),0) AS dispatchedUnits
     FROM LotDispatchLine line
     INNER JOIN LotDispatch d ON d.id=line.lotDispatchId
     WHERE line.productionId=? AND d.cancelledAt IS NULL`,
    [productionId],
  );
  const dispatchedUnits = Number(dispatched[0]?.dispatchedUnits ?? 0);
  if (dispatchedUnits % unitsPerPackage !== 0) {
    throw new UserInputError("As saídas históricas deste lote não correspondem a embalagens completas. Corrija primeiro os dados de expedição.");
  }

  return {
    isOpeningStock: production.recordOrigin === "INITIAL_STOCK",
    lotCode: String(production.lotCode),
    producedPackages,
    dispatchedPackages: dispatchedUnits / unitsPerPackage,
    maxStoredPackages: producedPackages - dispatchedUnits / unitsPerPackage,
  };
}

export async function adjustStockMap(formData: FormData) {
  const admin = await requireAdmin();
  const productionId = positiveId(formData, "productionId");
  const locationId = positiveId(formData, "locationId");
  const newQuantityPackages = Number(formData.get("newQuantityPackages") || 0);
  if (!Number.isInteger(newQuantityPackages) || newQuantityPackages < 0) throw new UserInputError("A nova quantidade é inválida.");
  const correctionReason = reason(formData);

  await db.$transaction(async (tx) => {
    const capacity = await getProductionCapacity(tx, productionId);
    const [location] = await tx.query<any[]>("SELECT id FROM StorageLocation WHERE id=? AND active=1 FOR UPDATE",[locationId]);
    if (!location) throw new UserInputError("A posição selecionada não existe.");

    const balances = await tx.query<any[]>(
      "SELECT locationId,quantityPackages FROM ProductionStorageBalance WHERE productionId=? FOR UPDATE",
      [productionId],
    );
    const current = Number(balances.find((row) => Number(row.locationId) === locationId)?.quantityPackages ?? 0);
    if (Number(formData.get("expectedQuantity")) !== current || !formData.has("expectedQuantity")) throw new UserInputError("O stock mudou. Atualize o mapa e confirme novamente.");
    if (current === newQuantityPackages) throw new UserInputError("A quantidade não foi alterada.");

    const otherTotal = balances
      .filter((row) => Number(row.locationId) !== locationId)
      .reduce((sum, row) => sum + Number(row.quantityPackages), 0);
    if (!capacity.isOpeningStock && otherTotal + newQuantityPackages > capacity.maxStoredPackages) {
      throw new UserInputError(`A correção excede o stock possível deste lote. Máximo atualmente armazenável: ${capacity.maxStoredPackages} embalagem(ns).`);
    }

    if(newQuantityPackages>current)await assertPalletAvailable(tx,locationId,productionId);
    if (newQuantityPackages === 0) {
      if (current > 0) await tx.productionStorageBalance.delete({ where: { productionId, locationId } });
    } else if (current > 0) {
      await tx.productionStorageBalance.update({ where: { productionId, locationId }, data: { quantityPackages: newQuantityPackages } });
    } else {
      await tx.productionStorageBalance.create({ data: { productionId, locationId, quantityPackages: newQuantityPackages } });
    }

    const delta = newQuantityPackages - current;
    if(capacity.isOpeningStock) await tx.production.update({where:{id:productionId},data:{quantityProduced:capacity.producedPackages+delta}});
    await tx.productionStorageMovement.create({
      data: {
        productionId,
        movementType: "ADJUSTMENT",
        fromLocationId: delta < 0 ? locationId : null,
        toLocationId: delta > 0 ? locationId : null,
        quantityPackages: Math.abs(delta),
        lotDispatchId: null,
        createdById: admin.id,
        reason: correctionReason,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "ADJUST",
        entity: "ProductionStorageBalance",
        entityId: `${productionId}:${locationId}`,
        details: { lotCode: capacity.lotCode, previousQuantity: current, newQuantity: newQuantityPackages, reason: correctionReason },
      },
    });
  });

  revalidatePath("/stock-map");
  revalidatePath("/lot-dispatch");
  revalidatePath("/traceability");
}

export async function transferStockMap(formData: FormData) {
  const admin = await requireAdmin();
  const productionId = positiveId(formData, "productionId");
  const fromLocationId = positiveId(formData, "fromLocationId");
  const toLocationId = positiveId(formData, "toLocationId");
  const quantityPackages = Number(formData.get("quantityPackages") || 0);
  if (!Number.isInteger(quantityPackages) || quantityPackages <= 0) throw new UserInputError("A quantidade a mover é inválida.");
  if (fromLocationId === toLocationId) throw new UserInputError("A posição de origem e destino não podem ser iguais.");
  const transferReason = reason(formData);

  await db.$transaction(async (tx) => {
    await getProductionCapacity(tx, productionId);
    const locations = await tx.query<any[]>("SELECT id FROM StorageLocation WHERE id IN (?,?) AND active=1 ORDER BY id FOR UPDATE",[fromLocationId,toLocationId]);
    if (locations.length !== 2) throw new UserInputError("Uma das posições selecionadas não existe.");

    const rows = await tx.query<any[]>(
      `SELECT locationId,quantityPackages
       FROM ProductionStorageBalance
       WHERE productionId=? AND locationId IN (?,?)
       FOR UPDATE`,
      [productionId, fromLocationId, toLocationId],
    );
    const fromQty = Number(rows.find((row) => Number(row.locationId) === fromLocationId)?.quantityPackages ?? 0);
    await assertPalletAvailable(tx,toLocationId,productionId);
    const toQty = Number(rows.find((row) => Number(row.locationId) === toLocationId)?.quantityPackages ?? 0);
    if (!formData.has("expectedQuantity") || Number(formData.get("expectedQuantity")) !== fromQty) throw new UserInputError("O stock mudou. Atualize o mapa e confirme novamente.");
    if (quantityPackages > fromQty) throw new UserInputError(`A posição de origem só tem ${fromQty} embalagem(ns) deste lote.`);

    if (quantityPackages === fromQty) {
      await tx.productionStorageBalance.delete({ where: { productionId, locationId: fromLocationId } });
    } else {
      await tx.productionStorageBalance.update({
        where: { productionId, locationId: fromLocationId },
        data: { quantityPackages: fromQty - quantityPackages },
      });
    }

    if (toQty > 0) {
      await tx.productionStorageBalance.update({
        where: { productionId, locationId: toLocationId },
        data: { quantityPackages: toQty + quantityPackages },
      });
    } else {
      await tx.productionStorageBalance.create({
        data: { productionId, locationId: toLocationId, quantityPackages },
      });
    }

    await tx.productionStorageMovement.create({
      data: {
        productionId,
        movementType: "TRANSFER",
        fromLocationId,
        toLocationId,
        quantityPackages,
        lotDispatchId: null,
        createdById: admin.id,
        reason: transferReason,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "TRANSFER",
        entity: "ProductionStorageBalance",
        entityId: String(productionId),
        details: { fromLocationId, toLocationId, quantityPackages, reason: transferReason },
      },
    });
  });

  revalidatePath("/stock-map");
  revalidatePath("/lot-dispatch");
  revalidatePath("/traceability");
}

export async function addUnlocatedStock(formData: FormData) {
  const admin = await requireAdmin();
  const productionId = positiveId(formData, "productionId");
  const locationId = positiveId(formData, "locationId");
  const quantityPackages = Number(formData.get("quantityPackages") || 0);
  if (!Number.isInteger(quantityPackages) || quantityPackages <= 0) throw new UserInputError("A quantidade a localizar é inválida.");
  const placementReason = reason(formData);

  await db.$transaction(async (tx) => {
    const capacity = await getProductionCapacity(tx, productionId);
    const [location] = await tx.query<any[]>("SELECT id FROM StorageLocation WHERE id=? AND active=1 FOR UPDATE",[locationId]);
    if (!location) throw new UserInputError("A posição selecionada não existe.");

    const balances = await tx.query<any[]>(
      "SELECT locationId,quantityPackages FROM ProductionStorageBalance WHERE productionId=? FOR UPDATE",
      [productionId],
    );
    await assertPalletAvailable(tx,locationId,productionId);
    const currentTotal = balances.reduce((sum, row) => sum + Number(row.quantityPackages), 0);
    const missing = capacity.maxStoredPackages - currentTotal;
    if (quantityPackages > missing) {
      throw new UserInputError(`Só existem ${missing} embalagem(ns) deste lote por localizar.`);
    }

    const current = Number(balances.find((row) => Number(row.locationId) === locationId)?.quantityPackages ?? 0);
    if (current > 0) {
      await tx.productionStorageBalance.update({
        where: { productionId, locationId },
        data: { quantityPackages: current + quantityPackages },
      });
    } else {
      await tx.productionStorageBalance.create({
        data: { productionId, locationId, quantityPackages },
      });
    }

    await tx.productionStorageMovement.create({
      data: {
        productionId,
        movementType: "ADJUSTMENT",
        fromLocationId: null,
        toLocationId: locationId,
        quantityPackages,
        lotDispatchId: null,
        createdById: admin.id,
        reason: placementReason,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "LOCATE",
        entity: "ProductionStorageBalance",
        entityId: String(productionId),
        details: { locationId, quantityPackages, reason: placementReason },
      },
    });
  });

  revalidatePath("/stock-map");
  revalidatePath("/lot-dispatch");
  revalidatePath("/traceability");
}


// Move exactly the contents the administrator reviewed. The destination must be
// empty: correcting a position must not silently merge two physical stacks.
export async function relocateStoragePosition(formData: FormData) {
  const admin=await requireAdmin();
  const fromLocationId=positiveId(formData,"fromLocationId"), toLocationId=positiveId(formData,"toLocationId");
  const correctionReason=reason(formData);
  if(fromLocationId===toLocationId) throw new UserInputError("Selecione uma posição diferente.");
  let expected: {productionId:number;quantityPackages:number}[];
  try { expected=JSON.parse(String(formData.get("expectedContents")??"")); }
  catch { throw new UserInputError("Atualize o mapa antes de corrigir a localização."); }
  if(!Array.isArray(expected)||!expected.length||expected.length>500||expected.some(row=>!row || !Number.isSafeInteger(row.productionId)||row.productionId<1||!Number.isSafeInteger(row.quantityPackages)||row.quantityPackages<1)||new Set(expected.map(row=>row.productionId)).size!==expected.length) throw new UserInputError("O conteúdo da posição é inválido. Atualize o mapa.");
  expected.sort((a,b)=>a.productionId-b.productionId);
  await db.$transaction(async tx=>{
    // Same production-first lock order as dispatches and individual corrections.
    for(const row of expected) await getProductionCapacity(tx,row.productionId);
    const positions=await tx.query<any[]>("SELECT id,zoneType FROM StorageLocation WHERE id IN (?,?) AND active=1 ORDER BY id FOR UPDATE",[fromLocationId,toLocationId]);
    if(positions.length!==2) throw new UserInputError("A posição selecionada já não está disponível.");
    if(positions[0].zoneType!==positions[1].zoneType) throw new UserInputError("Escolha um destino do mesmo tipo: estiba ou paletes.");
    const balances=await tx.query<any[]>("SELECT productionId,locationId,quantityPackages FROM ProductionStorageBalance WHERE locationId IN (?,?) ORDER BY locationId,productionId FOR UPDATE",[fromLocationId,toLocationId]);
    const source=balances.filter(row=>Number(row.locationId)===fromLocationId&&Number(row.quantityPackages)>0).sort((a,b)=>a.productionId-b.productionId);
    if(source.length!==expected.length||source.some((row,i)=>Number(row.productionId)!==expected[i].productionId||Number(row.quantityPackages)!==expected[i].quantityPackages)) throw new UserInputError("O stock mudou desde que abriu o mapa. Atualize e confirme novamente.");
    if(balances.some(row=>Number(row.locationId)===toLocationId&&Number(row.quantityPackages)>0)) throw new UserInputError("A posição de destino está ocupada. Escolha uma posição livre.");
    if(positions[0].zoneType==="PALLET"&&expected.length>1)throw new UserInputError("Separe os lotes sobrepostos em posições de palete distintas.");
    for(const row of expected) {
      await tx.execute("DELETE FROM ProductionStorageBalance WHERE productionId=? AND locationId=?",[row.productionId,fromLocationId]);
      await tx.execute(`INSERT INTO ProductionStorageBalance (productionId,locationId,quantityPackages) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE quantityPackages=VALUES(quantityPackages),updatedAt=NOW(3)`,[row.productionId,toLocationId,row.quantityPackages]);
      await tx.productionStorageMovement.create({data:{productionId:row.productionId,movementType:"TRANSFER",fromLocationId,toLocationId,quantityPackages:row.quantityPackages,createdById:admin.id,reason:correctionReason}});
    }
    await tx.auditLog.create({data:{userId:admin.id,action:"TRANSFER",entity:"StorageLocation",entityId:String(fromLocationId),details:{fromLocationId,toLocationId,contents:expected,reason:correctionReason}}});
  });
  for(const path of ["/stock-map","/lot-dispatch","/traceability"]) revalidatePath(path);
}

async function stockFeedback(action:(fd:FormData)=>Promise<void>,fd:FormData){
  await requireAdmin();
  try{await action(fd);return {ok:true as const};}
  catch(error){if(error instanceof UserInputError)return {ok:false as const,message:error.message};const reference=crypto.randomUUID();console.error("[stock-map]",reference,error);return {ok:false as const,message:`Não foi possível guardar. Confirme o estado antes de repetir. Referência: ${reference}`};}
}
export async function submitAdjustStockMap(fd:FormData){return stockFeedback(adjustStockMap,fd);}
export async function submitTransferStockMap(fd:FormData){return stockFeedback(transferStockMap,fd);}
export async function submitAddUnlocatedStock(fd:FormData){return stockFeedback(addUnlocatedStock,fd);}
export async function submitRelocateStoragePosition(fd:FormData){return stockFeedback(relocateStoragePosition,fd);}
