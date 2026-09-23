import bcrypt from "bcryptjs";
import { db, type DbTransaction } from "@/lib/db";

export const PIN_LENGTH = 8;
export const PIN_PATTERN = /^\d{8}$/;

export function assertValidPin(pin: string, label = "O PIN") {
  if (!PIN_PATTERN.test(pin)) throw new Error(`${label} deve ter exatamente 8 algarismos.`);
}

export async function assertPinAvailable(pin: string, excludeUserId?: number, client: DbTransaction = db) {
  const users = await client.user.findMany({
    where: excludeUserId ? { id: { not: excludeUserId } } : undefined,
    select: { id: true, name: true, pinHash: true },
  });
  for (const user of users) {
    if (await bcrypt.compare(pin, user.pinHash)) {
      throw new Error("Este PIN já está atribuído a outro utilizador. Escolha um PIN diferente.");
    }
  }
}
