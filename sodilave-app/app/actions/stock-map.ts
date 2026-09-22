"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db, type DbTransaction } from "@/lib/db";

const positiveId = (fd: FormData, key: string) => {
  const value = Number(fd.get(key) || 0);
  if (!Number.isInteger(value) || value <= 0) throw new Error("Identificador inválido.");
  return value;
};

const reason = (fd: FormData) => {
  const value = String(fd.get("reason") || "").trim().slice(0, 500);
  if (!value) throw new Error("Indique o motivo da correção.");
  return value;
};

async function getProductionCapacity(tx: DbTransaction, productionId: number) {
  const rows = await tx.query<any[]>(
    `SELECT
       p.id,
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
  if (!production) throw new Error("O lote de produção já não existe.");

  const unitsPerPackage = Number(production.unitsPerPackage);
  const producedPackages = Number(production.producedPackages);
  if (!Number.isInteger(unitsPerPackage) || unitsPerPackage <= 0 || !Number.isInteger(producedPackages) || producedPackages < 0) {
    throw new Error("O lote não tem uma quantidade de produção válida.");
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
    throw new Error("As saídas históricas deste lote não correspondem a embalagens completas. Corrija primeiro os dados de expedição.");
  }

  return {
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
  if (!Number.isInteger(newQuantityPackages) || newQuantityPackages < 0) throw new Error("A nova quantidade é inválida.");
  const correctionReason = reason(formData);

  await db.$transaction(async (tx) => {
    const location = await tx.storageLocation.findFirst({ where: { id: locationId, active: true } });
    if (!location) throw new Error("A posição selecionada não existe.");

    const capacity = await getProductionCapacity(tx, productionId);
    const balances = await tx.query<any[]>(
      "SELECT locationId,quantityPackages FROM ProductionStorageBalance WHERE productionId=? FOR UPDATE",
      [productionId],
    );
    const current = Number(balances.find((row) => Number(row.locationId) === locationId)?.quantityPackages ?? 0);
    if (current === newQuantityPackages) throw new Error("A quantidade não foi alterada.");

    const otherTotal = balances
      .filter((row) => Number(row.locationId) !== locationId)
      .reduce((sum, row) => sum + Number(row.quantityPackages), 0);
    if (otherTotal + newQuantityPackages > capacity.maxStoredPackages) {
      throw new Error(`A correção excede o stock possível deste lote. Máximo atualmente armazenável: ${capacity.maxStoredPackages} embalagem(ns).`);
    }

    if (newQuantityPackages === 0) {
      if (current > 0) await tx.productionStorageBalance.delete({ where: { productionId, locationId } });
    } else if (current > 0) {
      await tx.productionStorageBalance.update({ where: { productionId, locationId }, data: { quantityPackages: newQuantityPackages } });
    } else {
      await tx.productionStorageBalance.create({ data: { productionId, locationId, quantityPackages: newQuantityPackages } });
    }

    const delta = newQuantityPackages - current;
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
  if (!Number.isInteger(quantityPackages) || quantityPackages <= 0) throw new Error("A quantidade a mover é inválida.");
  if (fromLocationId === toLocationId) throw new Error("A posição de origem e destino não podem ser iguais.");
  const transferReason = reason(formData);

  await db.$transaction(async (tx) => {
    const locations = await tx.storageLocation.findMany({ where: { id: { in: [fromLocationId, toLocationId] }, active: true } });
    if (locations.length !== 2) throw new Error("Uma das posições selecionadas não existe.");

    const rows = await tx.query<any[]>(
      `SELECT locationId,quantityPackages
       FROM ProductionStorageBalance
       WHERE productionId=? AND locationId IN (?,?)
       FOR UPDATE`,
      [productionId, fromLocationId, toLocationId],
    );
    const fromQty = Number(rows.find((row) => Number(row.locationId) === fromLocationId)?.quantityPackages ?? 0);
    const toQty = Number(rows.find((row) => Number(row.locationId) === toLocationId)?.quantityPackages ?? 0);
    if (quantityPackages > fromQty) throw new Error(`A posição de origem só tem ${fromQty} embalagem(ns) deste lote.`);

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
