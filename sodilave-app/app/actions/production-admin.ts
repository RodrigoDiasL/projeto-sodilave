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

    const recordedStock = await getRecordedProductionStock(tx, id);
    if (recordedStock.length) {
      await reconcileProductionStock(tx, recordedStock, []);
      await replaceRecordedProductionStock(tx, id, []);
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
        details: { stockRestored: recordedStock.length > 0 },
      },
    });
  });

  revalidatePath("/admin/productions");
  revalidatePath("/production");
  revalidatePath("/admin/raw-material-lots");
}
