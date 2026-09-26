"use server";

import { createHash } from "node:crypto";
import { validOrderDate, orderReference as referenceForOrder } from "@/lib/order-values";
import { revalidatePath } from "next/cache";
import { requireOperationalUser, requireAdmin } from "@/lib/auth";
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

  const salesOrderItemId = Number(formData.get("salesOrderItemId"));
  const requestId = String(formData.get("requestId") ?? "");
  if (!Number.isSafeInteger(salesOrderItemId) || salesOrderItemId < 1) throw new Error("Selecione uma encomenda registada e o artigo a expedir.");
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error("Atualize a página antes de registar a saída.");
  const invoiceNumber = requiredText(formData, "invoiceNumber", "A fatura");
  const dispatchDate = requiredText(formData, "dispatchDate", "A data", 10);
  if (!validOrderDate(dispatchDate)) throw new Error("A data de saída é inválida.");

  const orderedQuantityUnits = Number(formData.get("orderedQuantityUnits") || 0);
  if (!Number.isSafeInteger(orderedQuantityUnits) || orderedQuantityUnits <= 0 || orderedQuantityUnits > 10000000) {
    throw new Error("A quantidade da encomenda deve ser um número inteiro superior a zero.");
  }

  const allocations = new Map<string, { productionId: number; locationId: number; quantityPackages: number }>();
  for (const [key, rawValue] of formData.entries()) {
    const match = /^stock_(\d+)_(\d+)$/.exec(key);
    if (!match) continue;
    const productionId = Number(match[1]);
    const locationId = Number(match[2]);
    const quantityPackages = Number(rawValue || 0);
    if (!Number.isSafeInteger(productionId) || productionId < 1 || !Number.isSafeInteger(locationId) || locationId < 1 || !Number.isSafeInteger(quantityPackages) || quantityPackages < 0 || quantityPackages > 10000000) {
      throw new Error("Uma das quantidades retiradas do stock é inválida.");
    }
    if (quantityPackages > 0) {
      allocations.set(`${productionId}-${locationId}`, { productionId, locationId, quantityPackages });
    }
  }

  if (!allocations.size) throw new Error("Selecione pelo menos uma posição de stock para dar saída.");

  if (allocations.size > 200) throw new Error("Selecione no máximo 200 posições por saída.");
  const allocationRows = [...allocations.values()].sort((a,b)=>a.productionId-b.productionId || a.locationId-b.locationId);
  const requestHash=createHash("sha256").update(JSON.stringify({salesOrderItemId,invoiceNumber,dispatchDate,orderedQuantityUnits,allocationRows})).digest("hex");
  const productionIds = [...new Set(allocationRows.map((row) => row.productionId))];
  const productionPlaceholders = productionIds.map(() => "?").join(",");

  const dispatch = await db.$transaction(async (tx) => {
    const orders=await tx.query<any[]>(`SELECT o.id,o.customerName,o.status,DATE_FORMAT(o.orderDate,'%Y-%m-%d') AS orderDate,i.productId,i.quantityUnits
      FROM SalesOrder o INNER JOIN SalesOrderItem i ON i.salesOrderId=o.id WHERE i.id=? FOR UPDATE`,[salesOrderItemId]);
    const order=orders[0];
    if(!order)throw new Error("A encomenda selecionada já não existe.");
    const existing=await tx.query<any[]>("SELECT id,requestHash,createdById,cancelledAt FROM LotDispatch WHERE requestId=?",[requestId]);
    if(existing.length){
      if(existing[0].requestHash!==requestHash||Number(existing[0].createdById)!==user.id)throw new Error("Este pedido já foi utilizado com outros dados. Atualize a página.");
      if(existing[0].cancelledAt)throw new Error("Esta saída já foi anulada. Atualize a página para registar uma nova.");
      return {id:Number(existing[0].id),salesOrderId:Number(order.id)};
    }
    if(order.status!=="OPEN")throw new Error("Esta encomenda foi anulada e não permite saídas.");
    if(dispatchDate<order.orderDate)throw new Error("A saída não pode ter data anterior à encomenda.");
    const previous=await tx.query<{orderedQuantityUnits:number}[]>("SELECT orderedQuantityUnits FROM LotDispatch WHERE salesOrderItemId=? AND cancelledAt IS NULL FOR UPDATE",[salesOrderItemId]);
    const remaining=Number(order.quantityUnits)-previous.reduce((sum,d)=>sum+Number(d.orderedQuantityUnits),0);
    if(orderedQuantityUnits>remaining)throw new Error(`A encomenda só tem ${remaining} artigo(s) por entregar nesta linha.`);
    const productId=Number(order.productId),customerName=String(order.customerName),orderReference=referenceForOrder(Number(order.id));
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
       ORDER BY p.id
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
        salesOrderItemId,
        requestId,
        requestHash,
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

    return {...saved,salesOrderId:Number(order.id)};
  });

  revalidatePath("/lot-dispatch");
  revalidatePath("/stock-map");
  revalidatePath("/dashboard");
  revalidatePath("/traceability");

  revalidatePath("/orders");
  revalidatePath(`/orders/${dispatch.salesOrderId}`);
  return { ok: true, id: dispatch.id, salesOrderId: dispatch.salesOrderId };
}

export async function cancelLotDispatch(formData: FormData) {
  const user = await requireAdmin();
  const id = Number(formData.get("dispatchId"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Saída inválida.");
  const reason = requiredText(formData, "reason", "O motivo da anulação", 500);

  await db.$transaction(async tx => {
    // Linked operations lock the order before productions, including cancellation.
    const linked=await tx.query<{salesOrderId:number}[]>(`SELECT i.salesOrderId FROM LotDispatch d
      INNER JOIN SalesOrderItem i ON i.id=d.salesOrderItemId WHERE d.id=?`,[id]);
    if(linked.length)await tx.query("SELECT id FROM SalesOrder WHERE id=? FOR UPDATE",[linked[0].salesOrderId]);
    const lines = await tx.query<{productionId:number;quantityUnits:number}[]>(
      "SELECT productionId,quantityUnits FROM LotDispatchLine WHERE lotDispatchId=? ORDER BY productionId", [id]);
    if (!lines.length) throw new Error("Esta saída não tem lotes para repor.");
    const productions = await tx.query<{id:number;status:string;unitsPerPackage:number}[]>(
      `SELECT p.id,p.status,COALESCE(p.unitsPerPackageSnapshot,pr.unitsPerPackage) AS unitsPerPackage
       FROM Production p INNER JOIN Product pr ON pr.id=p.productId
       WHERE p.id IN (${lines.map(()=>"?").join(",")}) ORDER BY p.id FOR UPDATE`, lines.map(row=>row.productionId));
    const dispatches = await tx.query<{id:number;cancelledAt:Date|null}[]>(
      "SELECT id,cancelledAt FROM LotDispatch WHERE id=? FOR UPDATE", [id]);
    if (!dispatches.length) throw new Error("Esta saída já não existe.");
    if (dispatches[0].cancelledAt) throw new Error("Esta saída já foi anulada.");
    if (productions.length !== lines.length || productions.some(row=>row.status!=="FINALIZED")) {
      throw new Error("Um dos lotes desta saída já não está finalizado.");
    }
    const movements = await tx.query<{productionId:number;fromLocationId:number|null;quantityPackages:number}[]>(
      "SELECT productionId,fromLocationId,quantityPackages FROM ProductionStorageMovement WHERE lotDispatchId=? AND movementType='DISPATCH' ORDER BY productionId,fromLocationId", [id]);
    // Legacy dispatches may not have position history. Never invent a return location.
    if (!movements.length || movements.some(row=>!row.fromLocationId || Number(row.quantityPackages)<=0 || !lines.some(line=>line.productionId===row.productionId)) ||
      lines.some(line=>movements.filter(row=>row.productionId===line.productionId).reduce((sum,row)=>sum+Number(row.quantityPackages),0) * Number(productions.find(row=>row.id===line.productionId)?.unitsPerPackage) !== Number(line.quantityUnits))) {
      throw new Error("Esta saída antiga não tem um histórico completo das posições. É necessária uma reconciliação de stock antes de a anular.");
    }
    for (const movement of movements) {
      await tx.execute(`INSERT INTO ProductionStorageBalance (productionId,locationId,quantityPackages)
        VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantityPackages=quantityPackages+?`,
        [movement.productionId,movement.fromLocationId,movement.quantityPackages,movement.quantityPackages]);
      await tx.productionStorageMovement.create({data:{
        productionId:movement.productionId,movementType:"DISPATCH_REVERSAL",fromLocationId:null,
        toLocationId:movement.fromLocationId,quantityPackages:movement.quantityPackages,
        lotDispatchId:id,createdById:user.id,reason,
      }});
    }
    await tx.lotDispatch.update({where:{id},data:{cancelledAt:new Date(),cancelledById:user.id,cancelReason:reason}});
    await tx.auditLog.create({data:{userId:user.id,action:"CANCEL",entity:"LotDispatch",entityId:String(id),details:{reason,movements}}});
  });
  for (const path of ["/lot-dispatch","/stock-map","/dashboard","/traceability","/orders"]) revalidatePath(path);
  revalidatePath("/orders/[id]", "page");
  return {ok:true};
}
