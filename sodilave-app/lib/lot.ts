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
    LIMIT 2
  `;
  if (rows.length > 1) {
    throw new Error("Existem vários lotes comerciais ativos para este produto. Feche os lotes duplicados antes de finalizar a produção.");
  }
  return rows[0] ?? null;
}

export async function validateCommercialLotMixture(commercialLotId: number, materials: { rawMaterialLotId: number; percentage: number | null }[]) {
  const expectedRows = await db.$queryRaw<{ rawMaterialId: number; percentage: unknown }[]>`
    SELECT rawMaterialId, percentage FROM CommercialLotMaterial
    WHERE commercialLotId = ${commercialLotId}
    ORDER BY rawMaterialId ASC
  `;

  const lotIds = [...new Set(materials.map((m) => m.rawMaterialLotId))];
  const actualLots = await db.rawMaterialLot.findMany({
    where: { id: { in: lotIds } },
    select: { id: true, rawMaterialId: true },
  });
  if (actualLots.length !== lotIds.length) return false;

  const expected = new Map<number, number>();
  for (const row of expectedRows) {
    expected.set(row.rawMaterialId, (expected.get(row.rawMaterialId) ?? 0) + Number(row.percentage));
  }

  const actual = new Map<number, number>();
  for (const material of materials) {
    const lot = actualLots.find((row) => row.id === material.rawMaterialLotId);
    if (!lot) return false;
    actual.set(lot.rawMaterialId, (actual.get(lot.rawMaterialId) ?? 0) + Number(material.percentage ?? 0));
  }

  if (expected.size !== actual.size) return false;
  for (const [rawMaterialId, percentage] of expected) {
    const actualPercentage = actual.get(rawMaterialId);
    if (actualPercentage === undefined || Math.abs(actualPercentage - percentage) > 0.0001) return false;
  }
  return true;
}
