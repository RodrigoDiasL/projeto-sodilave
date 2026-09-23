"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPastProductionEnabled } from "@/lib/operation-settings";

export async function saveOperationSettings(formData: FormData) {
  const user = await requireAdmin();
  const enabled = formData.get("pastProductionEnabled") === "on";
  await db.$transaction(async tx => {
    const previous = await getPastProductionEnabled(tx, true);
    await tx.execute(`INSERT INTO OperationSettings (id, pastProductionEnabled, updatedById, updatedAt)
      VALUES (1, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE
      pastProductionEnabled = VALUES(pastProductionEnabled), updatedById = VALUES(updatedById), updatedAt = NOW(3)`,
    [enabled, user.id]);
    await tx.auditLog.create({ data: { userId: user.id, action: "EDIT", entity: "OperationSettings", entityId: "1", details: { previous, pastProductionEnabled: enabled } } });
  });
  for (const path of ["/admin/settings", "/dashboard", "/production", "/production/new"]) revalidatePath(path);
  return { enabled };
}
