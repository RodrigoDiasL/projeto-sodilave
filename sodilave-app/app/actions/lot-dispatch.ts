"use server";

import { revalidatePath } from "next/cache";
import { requireOperationalUser } from "@/lib/auth";
import { db } from "@/lib/db";

type LockedProduction = {
  id: number;
  productId: number;
  status: string;
  unitsPerPackage: number | string | null;
  lotCode: string;
  productionUnit: string;
};

type LockedBalance = {
  productionId: number;
  locationId: number;
  quantityPackages: number | string;
  warehouseName: string;
  locationCode: string;
};

const requiredText = (fd: FormData, key: string, label: string, max = 191) => {
  const value = String(fd.get(key) || "").trim();
  if (!value) throw new Error(`${label} é obrigatório.`);
  if (value.length > max) throw new Error(`${label} é demasiado longo.`);
  return value;
};

export async function createLotDispatch(formData: FormData) {
  const user = await requireOperationalUser();

  const customerName = requiredText(formData, "customerName", "O cliente");
  const orderReference = requiredText(formData, "orderReference", "A encomenda");
  const invoiceNumber = requiredText(formData, "invoiceNumber", "A fatura");
  const dispatchDate = requiredText(formData, "dispatchDate", "A data", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate)) throw new Error("A data de saída é inválida.");

  const productId = Number(formData.get("productId") || 0);
  const orderedQuantityUnits = Number(formData.get("orderedQuantityUnits") || 0);
  if (!Number.isInteger(productId) || productId <= 0) throw new Error("Selecione o artigo da encomenda.");
  if (!Number.isInteger(orderedQuantityUnits) || orderedQuantityUnits <= 0) {
    throw new Error("A quantidade da encomenda deve ser um número inteiro superior a zero.");
  }

  const allocations = new Map<string, { productionId: number; locationId: number; quantityPackages: number }>();
  for (const [key, rawValue] of formData.entries()) {
    const match = /^stock_(\d+)_(\d+)$/.exec(key);
    if (!match) continue;
    const productionId = Number(match[1]);
    const locationId = Number(match[2]);
    const quantityPackages = Number(rawValue || 0);
    if (!Number.isInteger(quantityPackages) || quantityPackages < 0) {
      throw new Error("Uma das quantidades retiradas do stock é inválida.");
    }
    if (quantityPackages > 0) {
      allocations.set(`${productionId}-${locationId}`, { productionId, locationId, quantityPackages });
    }
  }

  if (!allocations.size) throw new Error("Selecione pelo menos uma posição de stock para dar saída.");

  const allocationRows = [...allocations.values()];
  const productionIds = [...new Set(allocationRows.map((row) => row.productionId))];
  const productionPlaceholders = productionIds.map(() => "?").join(",");

  const dispatch = await db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true } });
    if (!product) throw new Error("O artigo selecionado já não existe.");

    const lockedProductions = await tx.query<LockedProduction[]>(
      `SELECT
         p.id,
         p.productId,
         p.status,
         COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) AS unitsPerPackage,
         COALESCE(pla.labelCode, p.productionLot) AS lotCode,
         COALESCE(p.productionUnitSnapshot, pr.productionUnit, 'BAG') AS productionUnit
       FROM Production p
       INNER JOIN Product pr ON pr.id = p.productId
       LEFT JOIN ProductionLotAssociation pla ON pla.productionId = p.id
       WHERE p.id IN (${productionPlaceholders})
       FOR UPDATE`,
      productionIds,
    );
    if (lockedProductions.length !== productionIds.length) throw new Error("Um dos lotes selecionados já não existe.");

    const productionMap = new Map(lockedProductions.map((row) => [Number(row.id), row]));
    for (const row of lockedProductions) {
      if (row.status !== "FINALIZED") throw new Error(`O lote ${row.lotCode} ainda não está finalizado.`);
      if (Number(row.productId) !== productId) throw new Error("Todos os lotes selecionados têm de pertencer ao artigo da encomenda.");
      const unitsPerPackage = Number(row.unitsPerPackage);
      if (!Number.isInteger(unitsPerPackage) || unitsPerPackage <= 0) {
        throw new Error(`O lote ${row.lotCode} não tem unidades por embalagem válidas.`);
      }
    }

    const balanceConditions = allocationRows.map(() => "(b.productionId=? AND b.locationId=?)").join(" OR ");
    const balanceParams = allocationRows.flatMap((row) => [row.productionId, row.locationId]);
    const lockedBalances = await tx.query<LockedBalance[]>(
      `SELECT
         b.productionId,
         b.locationId,
         b.quantityPackages,
         l.warehouseName,
         l.code AS locationCode
       FROM ProductionStorageBalance b
       INNER JOIN StorageLocation l ON l.id = b.locationId
       WHERE ${balanceConditions}
       FOR UPDATE`,
      balanceParams,
    );
    const balanceMap = new Map(lockedBalances.map((row) => [`${row.productionId}-${row.locationId}`, row]));
    if (lockedBalances.length !== allocationRows.length) {
      throw new Error("Uma das posições selecionadas já não tem stock disponível.");
    }

    let allocatedUnits = 0;
    const unitsByProduction = new Map<number, number>();
    for (const allocation of allocationRows) {
      const key = `${allocation.productionId}-${allocation.locationId}`;
      const balance = balanceMap.get(key);
      const production = productionMap.get(allocation.productionId);
      if (!balance || !production) throw new Error("O stock selecionado foi alterado. Atualize a página e tente novamente.");

      const availablePackages = Number(balance.quantityPackages);
      if (allocation.quantityPackages > availablePackages) {
        throw new Error(`A posição ${balance.warehouseName} · ${balance.locationCode} só tem ${availablePackages} embalagem(ns) disponíveis.`);
      }

      const units = allocation.quantityPackages * Number(production.unitsPerPackage);
      allocatedUnits += units;
      unitsByProduction.set(allocation.productionId, (unitsByProduction.get(allocation.productionId) ?? 0) + units);
    }

    if (allocatedUnits !== orderedQuantityUnits) {
      throw new Error(`As posições selecionadas totalizam ${allocatedUnits} artigo(s), mas a encomenda tem ${orderedQuantityUnits}.`);
    }

    const saved = await tx.lotDispatch.create({
      data: {
        customerName,
        orderReference,
        invoiceNumber,
        productId,
        orderedQuantityUnits,
        dispatchDate,
        createdById: user.id,
      },
    });

    await tx.lotDispatchLine.createMany({
      data: [...unitsByProduction.entries()].map(([productionId, quantityUnits]) => ({
        lotDispatchId: saved.id,
        productionId,
        quantityUnits,
      })),
    });

    for (const allocation of allocationRows) {
      const key = `${allocation.productionId}-${allocation.locationId}`;
      const balance = balanceMap.get(key)!;
      const remaining = Number(balance.quantityPackages) - allocation.quantityPackages;

      if (remaining === 0) {
        await tx.productionStorageBalance.delete({
          where: { productionId: allocation.productionId, locationId: allocation.locationId },
        });
      } else {
        await tx.productionStorageBalance.update({
          where: { productionId: allocation.productionId, locationId: allocation.locationId },
          data: { quantityPackages: remaining },
        });
      }

      await tx.productionStorageMovement.create({
        data: {
          productionId: allocation.productionId,
          movementType: "DISPATCH",
          fromLocationId: allocation.locationId,
          toLocationId: null,
          quantityPackages: allocation.quantityPackages,
          lotDispatchId: saved.id,
          createdById: user.id,
          reason: `Saída para ${customerName} · encomenda ${orderReference} · fatura ${invoiceNumber}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "CREATE",
        entity: "LotDispatch",
        entityId: String(saved.id),
        details: {
          customerName,
          orderReference,
          invoiceNumber,
          productId,
          productCode: product.code,
          orderedQuantityUnits,
          dispatchDate,
          allocations: allocationRows.map((allocation) => {
            const production = productionMap.get(allocation.productionId)!;
            const balance = balanceMap.get(`${allocation.productionId}-${allocation.locationId}`)!;
            return {
              productionId: allocation.productionId,
              lotCode: production.lotCode,
              locationId: allocation.locationId,
              location: `${balance.warehouseName} · ${balance.locationCode}`,
              quantityPackages: allocation.quantityPackages,
              quantityUnits: allocation.quantityPackages * Number(production.unitsPerPackage),
            };
          }),
        },
      },
    });

    return saved;
  });

  revalidatePath("/lot-dispatch");
  revalidatePath("/stock-map");
  revalidatePath("/dashboard");
  revalidatePath("/traceability");

  return { ok: true, id: dispatch.id };
}
