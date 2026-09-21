"use server";

import { revalidatePath } from "next/cache";
import { requireOperationalUser } from "@/lib/auth";
import { db } from "@/lib/db";

type LockedProduction = {
  id: number;
  productId: number;
  status: string;
  quantityProduced: number | string | null;
  unitsPerPackage: number | string | null;
  lotCode: string;
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

  const allocations = new Map<number, number>();
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("lot_")) continue;
    const productionId = Number(key.slice(4));
    const quantityUnits = Number(rawValue || 0);
    if (!Number.isInteger(productionId) || productionId <= 0) continue;
    if (!Number.isFinite(quantityUnits) || quantityUnits < 0 || !Number.isInteger(quantityUnits)) {
      throw new Error("Uma das quantidades atribuídas aos lotes é inválida.");
    }
    if (quantityUnits > 0) allocations.set(productionId, quantityUnits);
  }

  if (!allocations.size) throw new Error("Selecione pelo menos um lote para dar saída.");
  const allocatedTotal = [...allocations.values()].reduce((sum, value) => sum + value, 0);
  if (allocatedTotal !== orderedQuantityUnits) {
    throw new Error(`A soma dos lotes selecionados (${allocatedTotal}) tem de ser exatamente igual à quantidade da encomenda (${orderedQuantityUnits}).`);
  }

  const productionIds = [...allocations.keys()];
  const placeholders = productionIds.map(() => "?").join(",");

  const dispatch = await db.$transaction(async (tx) => {
    const locked = await tx.query<LockedProduction[]>(
      `SELECT
         p.id,
         p.productId,
         p.status,
         p.quantityProduced,
         COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) AS unitsPerPackage,
         COALESCE(pla.labelCode, p.productionLot) AS lotCode
       FROM Production p
       INNER JOIN Product pr ON pr.id = p.productId
       LEFT JOIN ProductionLotAssociation pla ON pla.productionId = p.id
       WHERE p.id IN (${placeholders})
       FOR UPDATE`,
      productionIds,
    );

    if (locked.length !== productionIds.length) throw new Error("Um dos lotes selecionados já não existe.");

    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true } });
    if (!product) throw new Error("O artigo selecionado já não existe.");

    const alreadyDispatched = await tx.query<{ productionId: number; dispatchedUnits: number | string }[]>(
      `SELECT line.productionId, COALESCE(SUM(line.quantityUnits), 0) AS dispatchedUnits
       FROM LotDispatchLine line
       INNER JOIN LotDispatch dispatch ON dispatch.id = line.lotDispatchId
       WHERE line.productionId IN (${placeholders})
         AND dispatch.cancelledAt IS NULL
       GROUP BY line.productionId`,
      productionIds,
    );
    const dispatchedMap = new Map(alreadyDispatched.map((row) => [Number(row.productionId), Number(row.dispatchedUnits)]));

    for (const row of locked) {
      if (row.status !== "FINALIZED") throw new Error(`O lote ${row.lotCode} ainda não está finalizado.`);
      if (Number(row.productId) !== productId) throw new Error("Todos os lotes selecionados têm de pertencer ao mesmo artigo da encomenda.");

      const unitsPerPackage = Number(row.unitsPerPackage);
      const producedPackages = Number(row.quantityProduced);
      if (!Number.isInteger(unitsPerPackage) || unitsPerPackage <= 0 || !Number.isFinite(producedPackages) || producedPackages < 0) {
        throw new Error(`O lote ${row.lotCode} não tem uma quantidade de stock válida.`);
      }

      const producedUnits = Math.trunc(producedPackages) * unitsPerPackage;
      const availableUnits = producedUnits - (dispatchedMap.get(Number(row.id)) ?? 0);
      const requestedUnits = allocations.get(Number(row.id)) ?? 0;
      if (requestedUnits > availableUnits) {
        throw new Error(`O lote ${row.lotCode} só tem ${availableUnits} artigo(s) disponíveis em stock.`);
      }
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
      data: productionIds.map((productionId) => ({
        lotDispatchId: saved.id,
        productionId,
        quantityUnits: allocations.get(productionId),
      })),
    });

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
          lots: locked.map((row) => ({
            productionId: Number(row.id),
            lotCode: row.lotCode,
            quantityUnits: allocations.get(Number(row.id)) ?? 0,
          })),
        },
      },
    });

    return saved;
  });

  revalidatePath("/lot-dispatch");
  revalidatePath("/dashboard");
  revalidatePath("/traceability");

  return { ok: true, id: dispatch.id };
}
