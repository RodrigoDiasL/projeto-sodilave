import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export type ConfirmationWorker = { id: number; name: string };

export async function getConfirmationWorkers(currentUserId?: number): Promise<ConfirmationWorker[]> {
  const users = await db.user.findMany({
    where: {
      active: true,
      role: { in: ["OPERATOR", "PRODUCTION_MANAGER", "ADMIN"] },
      ...(currentUserId ? { id: { not: currentUserId } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}

export async function verifySecondWorker(formData: FormData, currentUserId: number) {
  const secondWorkerId = Number(formData.get("secondWorkerId") || 0);
  const secondWorkerPin = String(formData.get("secondWorkerPin") || "").trim();
  if (!secondWorkerId) throw new Error("Selecione o colega que está a trabalhar no turno.");
  if (secondWorkerId === currentUserId) throw new Error("A confirmação tem de ser feita por um segundo trabalhador.");
  if (!/^\d{4,8}$/.test(secondWorkerPin)) throw new Error("O segundo trabalhador deve introduzir um PIN válido.");

  const worker = await db.user.findFirst({
    where: { id: secondWorkerId, active: true, role: { in: ["OPERATOR", "PRODUCTION_MANAGER", "ADMIN"] } },
    select: { id: true, name: true, pinHash: true },
  });
  if (!worker || !(await bcrypt.compare(secondWorkerPin, worker.pinHash))) {
    throw new Error("O PIN do segundo trabalhador está incorreto.");
  }
  return { id: worker.id, name: worker.name };
}

export async function saveRecordConfirmation(entity: string, entityId: number, confirmedById: number) {
  await db.$executeRaw`
    INSERT INTO RecordConfirmation (entity, entityId, confirmedById, confirmedAt)
    VALUES (${entity}, ${entityId}, ${confirmedById}, NOW(3))
    ON DUPLICATE KEY UPDATE confirmedById = VALUES(confirmedById), confirmedAt = VALUES(confirmedAt)
  `;
}
