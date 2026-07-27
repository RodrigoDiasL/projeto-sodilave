import { db } from "@/lib/db";

function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

type MachineConfigRow = { majorLetter: string; minorLetter: string };

export async function generateProductionLot(machineCode: string, shiftCode: string, date = new Date()) {
  const rows = await db.$queryRaw<MachineConfigRow[]>`
    SELECT majorLetter, minorLetter
    FROM MachineLotConfig
    WHERE machineId = (SELECT id FROM Machine WHERE code = ${machineCode} LIMIT 1)
    LIMIT 1
  `;
  const config = rows[0] ?? { majorLetter: "A", minorLetter: "A" };
  const weekday = date.getDay();
  const week = String(isoWeek(date)).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  const candidate = `${config.majorLetter}${config.minorLetter}${shiftCode}${weekday}${week}${year}m${machineCode}`;

  const exists = await db.production.findUnique({ where: { productionLot: candidate }, select: { id: true } });
  if (exists) {
    throw new Error("Já existe uma produção com este código interno. Atualize a configuração de lote da máquina antes de criar uma nova produção.");
  }
  return candidate;
}

export async function getActiveCommercialLotForProduct(productId: number) {
  const rows = await db.$queryRaw<{ id: number; code: string }[]>`
    SELECT id, code FROM CommercialLot
    WHERE productId = ${productId} AND status = 'ACTIVE'
    ORDER BY openedAt DESC, id DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function validateCommercialLotMixture(commercialLotId: number, materials: { rawMaterialLotId: number; percentage: number | null }[]) {
  const expected = await db.$queryRaw<{ rawMaterialId: number; percentage: unknown }[]>`
    SELECT rawMaterialId, percentage FROM CommercialLotMaterial
    WHERE commercialLotId = ${commercialLotId}
    ORDER BY rawMaterialId ASC
  `;
  const actualLots = await db.rawMaterialLot.findMany({
    where: { id: { in: materials.map((m) => m.rawMaterialLotId) } },
    select: { id: true, rawMaterialId: true },
  });
  const actual = materials
    .map((m) => ({ rawMaterialId: actualLots.find((lot) => lot.id === m.rawMaterialLotId)?.rawMaterialId ?? 0, percentage: Number(m.percentage ?? 0) }))
    .sort((a, b) => a.rawMaterialId - b.rawMaterialId);
  if (expected.length !== actual.length) return false;
  return expected.every((row, index) => row.rawMaterialId === actual[index].rawMaterialId && Number(row.percentage) === actual[index].percentage);
}
