"use server";

import { Prisma, RecordStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { reconcileProductionStock } from "@/lib/raw-material-stock";

export async function cancelProduction(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Produção inválida.");

  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: number; status: RecordStatus }[]>(Prisma.sql`
      SELECT id, status FROM Production WHERE id=${id} FOR UPDATE
    `);
    const production = rows[0];
    if (!production) throw new Error("A produção já não existe.");
    if (production.status === RecordStatus.CANCELLED) throw new Error("A produção já se encontra cancelada.");

    const materials = production.status === RecordStatus.FINALIZED
      ? await tx.productionMaterial.findMany({
          where: { productionId: id },
          select: { rawMaterialLotId: true, quantityKg: true },
        })
      : [];

    if (materials.length) await reconcileProductionStock(tx, materials, []);
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
        details: { stockRestored: materials.length > 0 },
      },
    });
  });

  revalidatePath("/admin/productions");
  revalidatePath("/production");
  revalidatePath("/admin/raw-material-lots");
}
