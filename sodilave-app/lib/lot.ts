import { db } from "@/lib/db";

function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export async function generateProductionLot(machineCode: string, shiftCode: string, date = new Date()) {
  const rule = await db.productionLotRule.findFirst({ where: { active: true }, orderBy: { id: "asc" } });
  const prefix = rule?.prefix ?? "SD";
  const template = rule?.template ?? "{PREFIX}-{YY}{WW}-{SHIFT}-{MACHINE}-{SEQ}";
  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
  const count = await db.production.count({ where: { createdAt: { gte: dayStart, lte: dayEnd } } });

  for (let offset = 1; offset <= 9999; offset++) {
    const sequence = count + offset;
    const tokens: Record<string, string> = {
      PREFIX: prefix,
      YYYY: String(date.getFullYear()),
      YY: String(date.getFullYear()).slice(-2),
      MM: String(date.getMonth() + 1).padStart(2, "0"),
      DD: String(date.getDate()).padStart(2, "0"),
      WW: String(isoWeek(date)).padStart(2, "0"),
      SHIFT: shiftCode,
      MACHINE: machineCode,
      SEQ: String(sequence).padStart(3, "0"),
    };
    const candidate = template.replace(/\{(\w+)\}/g, (_, key) => tokens[key] ?? key);
    const exists = await db.production.findUnique({ where: { productionLot: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }

  throw new Error("Não foi possível gerar um lote de produção único.");
}
