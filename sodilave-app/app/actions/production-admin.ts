"use server";

import { RecordStatus } from "@/lib/db-types";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { getRecordedProductionStock, reconcileProductionStock, replaceRecordedProductionStock } from "@/lib/raw-material-stock";

export async function cancelProduction(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Produção inválida.");

  await db.$transaction(async (tx) => {
    const rows = await tx.query<{ id: number; status: RecordStatus }[]>(
      "SELECT id, status FROM Production WHERE id=? FOR UPDATE",
      [id],
    );
    const production = rows[0];
    if (!production) throw new Error("A produção já não existe.");
    if (production.status === RecordStatus.CANCELLED) throw new Error("A produção já se encontra cancelada.");

    const dispatches = await tx.query<{ total: number | string }[]>(
      `SELECT COUNT(*) AS total
       FROM LotDispatchLine line
       INNER JOIN LotDispatch d ON d.id=line.lotDispatchId
       WHERE line.productionId=? AND d.cancelledAt IS NULL`,
      [id],
    );
    if (Number(dispatches[0]?.total ?? 0) > 0) {
      throw new Error("Esta produção já tem saídas para clientes e não pode ser cancelada. Corrija primeiro os movimentos de expedição.");
    }

    const finishedBalances = await tx.query<{ locationId: number; quantityPackages: number | string }[]>(
      "SELECT locationId,quantityPackages FROM ProductionStorageBalance WHERE productionId=? FOR UPDATE",
      [id],
    );

    const recordedStock = await getRecordedProductionStock(tx, id);
    if (recordedStock.length) {
      await reconcileProductionStock(tx, recordedStock, []);
      await replaceRecordedProductionStock(tx, id, []);
    }

    for (const balance of finishedBalances) {
      const quantityPackages = Number(balance.quantityPackages);
      if (quantityPackages > 0) {
        await tx.productionStorageMovement.create({
          data: {
            productionId: id,
            movementType: "ADJUSTMENT",
            fromLocationId: Number(balance.locationId),
            toLocationId: null,
            quantityPackages,
            lotDispatchId: null,
            createdById: admin.id,
            reason: "Remoção de stock devido ao cancelamento da produção.",
          },
        });
      }
    }
    if (finishedBalances.length) {
      await tx.productionStorageBalance.deleteMany({ where: { productionId: id } });
    }

    await tx.production.update({
      where: { id },
      data: { status: RecordStatus.CANCELLED, finalizedAt: null },
    });
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "CANCEL",
        entity: "Production",
        entityId: String(id),
        details: { stockRestored: recordedStock.length > 0, finishedStockRemoved: finishedBalances.length > 0 },
      },
    });
  });

  revalidatePath("/admin/productions");
  revalidatePath("/production");
  revalidatePath("/admin/raw-material-lots");
  revalidatePath("/stock-map");
  revalidatePath("/lot-dispatch");
  revalidatePath("/traceability");
}
