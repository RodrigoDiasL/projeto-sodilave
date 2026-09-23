import { db, type DbTransaction } from "@/lib/db";

export async function getPastProductionEnabled(client: DbTransaction = db, lock = false): Promise<boolean> {
  const rows = await client.query<{ pastProductionEnabled: number }[]>(
    `SELECT pastProductionEnabled FROM OperationSettings WHERE id = 1${lock ? " FOR UPDATE" : ""}`,
  );
  return Number(rows[0]?.pastProductionEnabled ?? 0) === 1;
}

export async function assertPastProductionEnabled(client: DbTransaction = db, lock = false) {
  if (!await getPastProductionEnabled(client, lock)) {
    throw new Error("O registo de produção passada está desativado. Peça a um administrador para o ativar nas definições.");
  }
}
