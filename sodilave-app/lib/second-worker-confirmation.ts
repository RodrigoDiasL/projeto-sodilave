import { UserInputError } from "@/lib/action-error";
import { reserveAuthAttempt } from "@/lib/auth-rate-limit";
import bcrypt from "bcryptjs";
import type { DbTransaction } from "@/lib/db";
import { db } from "@/lib/db";
import { getShiftWindow } from "@/lib/shift";

export type ConfirmationWorker = { id: number; name: string; sessionVersion?: number };

export async function getConfirmationWorkers(currentUserId?: number): Promise<ConfirmationWorker[]> {
  const users = await db.user.findMany({
    where: {
      active: true,
      role: { in: ["OPERATOR", "PRODUCTION_MANAGER", "LOGISTICS"] },
      ...(currentUserId ? { id: { not: currentUserId } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}

export async function getShiftPeerConfirmation(currentUserId: number, at = new Date(), client: DbTransaction = db): Promise<ConfirmationWorker | null> {
  const window = getShiftWindow(at);
  const rows = await client.query<{ id: number; name: string }[]>(
    `SELECT u.id, u.name, u.sessionVersion
     FROM ShiftPeerConfirmation c
     INNER JOIN User u ON u.id = c.confirmedById
     WHERE c.operatorId = ?
       AND c.shiftStart = ?
       AND c.shiftCode = ?
       AND u.active = 1
       AND u.role IN ('OPERATOR','PRODUCTION_MANAGER','LOGISTICS')
     LIMIT 1`,
    [currentUserId, window.start, window.code],
  );
  return rows[0] ?? null;
}

export async function verifySecondWorker(formData: FormData, currentUserId: number, client: DbTransaction = db) {
  const currentUser = await client.user.findUnique({
    where: { id: currentUserId },
    select: { role: true, active: true },
  });
  if (!currentUser?.active) throw new UserInputError("O utilizador atual já não está ativo.");
  if (currentUser.role === "ADMIN") return null;

  const existingConfirmation = await getShiftPeerConfirmation(currentUserId, new Date(), client);
  if (existingConfirmation) return existingConfirmation;

  const secondWorkerId = Number(formData.get("secondWorkerId") || 0);
  const secondWorkerPin = String(formData.get("secondWorkerPin") || "").trim();
  if (!Number.isSafeInteger(secondWorkerId) || secondWorkerId <= 0) throw new UserInputError("Selecione o colega que está a trabalhar no turno.");
  if (secondWorkerId === currentUserId) throw new UserInputError("A confirmação tem de ser feita por um segundo trabalhador.");
  if (!/^\d{8}$/.test(secondWorkerPin)) throw new UserInputError("O segundo trabalhador deve introduzir um PIN válido de 8 algarismos.");

  await reserveAuthAttempt(`peer:operator:${currentUserId}`, 5);
  await reserveAuthAttempt(`peer:target:${secondWorkerId}`, 5);
  const worker = await client.user.findFirst({
    where: { id: secondWorkerId, active: true, role: { in: ["OPERATOR", "PRODUCTION_MANAGER", "LOGISTICS"] } },
    select: { id: true, name: true, pinHash: true, sessionVersion: true },
  });
  if (!worker || !(await bcrypt.compare(secondWorkerPin, worker.pinHash))) {
    throw new UserInputError("O PIN do segundo trabalhador está incorreto ou esta conta não pode confirmar como colega de turno.");
  }

  return { id: worker.id, name: worker.name, sessionVersion: worker.sessionVersion };
}

export async function saveRecordConfirmation(entity: string, entityId: number, worker: ConfirmationWorker, operatorId: number, client: DbTransaction = db) {
  const users = await client.query<{ sessionVersion: number }[]>(
    "SELECT sessionVersion FROM User WHERE id=? AND active=1 AND role IN ('OPERATOR','PRODUCTION_MANAGER','LOGISTICS') LOCK IN SHARE MODE", [worker.id]);
  if (!users[0] || users[0].sessionVersion !== worker.sessionVersion) throw new UserInputError("As credenciais do segundo trabalhador mudaram. Confirme novamente.");
  const window = getShiftWindow();
  await client.$executeRaw`
    INSERT INTO ShiftPeerConfirmation (operatorId, confirmedById, shiftCode, shiftStart, confirmedAt)
    VALUES (${operatorId}, ${worker.id}, ${window.code}, ${window.start}, NOW(3))
    ON DUPLICATE KEY UPDATE confirmedById = VALUES(confirmedById), shiftCode = VALUES(shiftCode), confirmedAt = VALUES(confirmedAt)
  `;
  await client.$executeRaw`
    INSERT INTO RecordConfirmation (entity, entityId, confirmedById, confirmedAt)
    VALUES (${entity}, ${entityId}, ${worker.id}, NOW(3))
    ON DUPLICATE KEY UPDATE confirmedById = VALUES(confirmedById), confirmedAt = VALUES(confirmedAt)
  `;
}
