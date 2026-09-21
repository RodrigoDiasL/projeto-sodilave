import bcrypt from "bcryptjs";
import type { DbTransaction } from "@/lib/db";
import { db } from "@/lib/db";
import { getShiftWindow } from "@/lib/shift";

export type ConfirmationWorker = { id: number; name: string };
type ConfirmationClient = Pick<DbTransaction, "$executeRaw">;

export async function getConfirmationWorkers(currentUserId?: number): Promise<ConfirmationWorker[]> {
  const users = await db.user.findMany({
    where: {
      active: true,
      role: { in: ["OPERATOR", "PRODUCTION_MANAGER"] },
      ...(currentUserId ? { id: { not: currentUserId } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}

export async function getShiftPeerConfirmation(currentUserId: number, at = new Date()): Promise<ConfirmationWorker | null> {
  const window = getShiftWindow(at);
  const rows = await db.query<{ id: number; name: string }[]>(
    `SELECT u.id, u.name
     FROM ShiftPeerConfirmation c
     INNER JOIN User u ON u.id = c.confirmedById
     WHERE c.operatorId = ?
       AND c.shiftStart = ?
       AND c.shiftCode = ?
       AND u.active = 1
       AND u.role IN ('OPERATOR','PRODUCTION_MANAGER')
     LIMIT 1`,
    [currentUserId, window.start, window.code],
  );
  return rows[0] ?? null;
}

export async function verifySecondWorker(formData: FormData, currentUserId: number) {
  const currentUser = await db.user.findUnique({
    where: { id: currentUserId },
    select: { role: true, active: true },
  });
  if (!currentUser?.active) throw new Error("O utilizador atual já não está ativo.");
  if (currentUser.role === "ADMIN") return null;

  const existingConfirmation = await getShiftPeerConfirmation(currentUserId);
  if (existingConfirmation) return existingConfirmation;

  const secondWorkerId = Number(formData.get("secondWorkerId") || 0);
  const secondWorkerPin = String(formData.get("secondWorkerPin") || "").trim();
  if (!secondWorkerId) throw new Error("Selecione o colega que está a trabalhar no turno.");
  if (secondWorkerId === currentUserId) throw new Error("A confirmação tem de ser feita por um segundo trabalhador.");
  if (!/^\d{8}$/.test(secondWorkerPin)) throw new Error("O segundo trabalhador deve introduzir um PIN válido de 8 algarismos.");

  const worker = await db.user.findFirst({
    where: { id: secondWorkerId, active: true, role: { in: ["OPERATOR", "PRODUCTION_MANAGER"] } },
    select: { id: true, name: true, pinHash: true },
  });
  if (!worker || !(await bcrypt.compare(secondWorkerPin, worker.pinHash))) {
    throw new Error("O PIN do segundo trabalhador está incorreto ou esta conta não pode confirmar como colega de turno.");
  }

  const window = getShiftWindow();
  await db.$executeRaw`
    INSERT INTO ShiftPeerConfirmation (operatorId, confirmedById, shiftCode, shiftStart, confirmedAt)
    VALUES (${currentUserId}, ${worker.id}, ${window.code}, ${window.start}, NOW(3))
    ON DUPLICATE KEY UPDATE confirmedById = VALUES(confirmedById), shiftCode = VALUES(shiftCode), confirmedAt = VALUES(confirmedAt)
  `;

  return { id: worker.id, name: worker.name };
}

export async function saveRecordConfirmation(entity: string, entityId: number, confirmedById: number, client: ConfirmationClient = db) {
  await client.$executeRaw`
    INSERT INTO RecordConfirmation (entity, entityId, confirmedById, confirmedAt)
    VALUES (${entity}, ${entityId}, ${confirmedById}, NOW(3))
    ON DUPLICATE KEY UPDATE confirmedById = VALUES(confirmedById), confirmedAt = VALUES(confirmedAt)
  `;
}
