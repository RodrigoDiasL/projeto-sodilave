"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

async function requireLotManager() {
  const user = await requireUser();
  if (user.role !== "ADMIN" && !(user.role === "PRODUCTION_MANAGER" && user.name.trim().toLowerCase() === "luís")) throw new Error("Apenas administradores e o Luís podem gerir lotes.");
  return user;
}

function nextLetter(letter: string) {
  const code = letter.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return "A";
  if (code === 90) throw new Error("A sequência de letras chegou a Z. Defina uma nova regra antes de continuar.");
  return String.fromCharCode(code + 1);
}

export async function createCommercialLot(fd: FormData) {
  const user = await requireLotManager();
  const productId = Number(fd.get("productId"));
  const notes = String(fd.get("notes") || "").trim().slice(0, 1500) || null;
  if (!Number.isInteger(productId) || productId <= 0) throw new Error("Selecione um produto.");

  const existing = await db.$queryRaw<{ id: number; code: string }[]>`SELECT id, code FROM CommercialLot WHERE productId=${productId} AND status='ACTIVE' LIMIT 1`;
  if (existing.length) throw new Error(`Já existe o lote comercial ativo ${existing[0].code} para este produto. Feche-o antes de criar outro.`);

  const materials: { rawMaterialId: number; percentage: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const rawMaterialId = Number(fd.get(`rawMaterialId_${i}`) || 0);
    const percentage = Number(fd.get(`percentage_${i}`) || 0);
    if (!rawMaterialId) continue;
    if (!Number.isInteger(rawMaterialId) || rawMaterialId <= 0 || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) throw new Error("A mistura contém valores inválidos.");
    if (materials.some((row) => row.rawMaterialId === rawMaterialId)) throw new Error("A mesma matéria-prima não pode aparecer duas vezes.");
    materials.push({ rawMaterialId, percentage });
  }
  if (!materials.length || Math.abs(materials.reduce((sum, row) => sum + row.percentage, 0) - 100) > 0.001) throw new Error("A mistura do lote comercial tem de totalizar 100%.");

  const year = String(new Date().getFullYear()).slice(-2);
  const rows = await db.$queryRaw<{ code: string }[]>`SELECT code FROM CommercialLot WHERE code LIKE ${`L${year}%`} ORDER BY code DESC LIMIT 1`;
  const last = rows[0]?.code?.slice(3) ?? "000";
  const sequence = Number(last) + 1;
  if (sequence > 999) throw new Error("Foi atingido o limite anual de lotes comerciais.");
  const code = `L${year}${String(sequence).padStart(3, "0")}`;

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO CommercialLot (code, productId, status, notes, createdById) VALUES (${code}, ${productId}, 'ACTIVE', ${notes}, ${user.id})`;
    const created = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM CommercialLot WHERE code=${code} LIMIT 1`;
    for (const row of materials) await tx.$executeRaw`INSERT INTO CommercialLotMaterial (commercialLotId, rawMaterialId, percentage) VALUES (${created[0].id}, ${row.rawMaterialId}, ${row.percentage})`;
  });
  await db.auditLog.create({ data: { userId: user.id, action: "CREATE", entity: "CommercialLot", entityId: code, details: { productId, materials } } });
  revalidatePath("/commercial-lots");
}

export async function closeCommercialLot(fd: FormData) {
  const user = await requireLotManager();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Lote inválido.");
  await db.$executeRaw`UPDATE CommercialLot SET status='CLOSED', closedAt=NOW(3), closedById=${user.id} WHERE id=${id} AND status='ACTIVE'`;
  await db.auditLog.create({ data: { userId: user.id, action: "CLOSE", entity: "CommercialLot", entityId: String(id) } });
  revalidatePath("/commercial-lots");
}

export async function changeMachineLotConfig(fd: FormData) {
  const user = await requireLotManager();
  const machineId = Number(fd.get("machineId"));
  const changeType = String(fd.get("changeType") || "");
  const reason = String(fd.get("reason") || "").trim().slice(0, 2000);
  if (!Number.isInteger(machineId) || machineId <= 0 || !["MAJOR", "MINOR"].includes(changeType) || !reason) throw new Error("Preencha a máquina, o tipo de alteração e o motivo.");
  const rows = await db.$queryRaw<{ majorLetter: string; minorLetter: string }[]>`SELECT majorLetter, minorLetter FROM MachineLotConfig WHERE machineId=${machineId} LIMIT 1`;
  const previous = rows[0] ?? { majorLetter: "A", minorLetter: "A" };
  const next = changeType === "MAJOR" ? { majorLetter: nextLetter(previous.majorLetter), minorLetter: "A" } : { majorLetter: previous.majorLetter, minorLetter: nextLetter(previous.minorLetter) };
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO MachineLotConfig (machineId, majorLetter, minorLetter, updatedById) VALUES (${machineId}, ${next.majorLetter}, ${next.minorLetter}, ${user.id}) ON DUPLICATE KEY UPDATE majorLetter=VALUES(majorLetter), minorLetter=VALUES(minorLetter), updatedById=VALUES(updatedById)`;
    await tx.$executeRaw`INSERT INTO MachineLotConfigHistory (machineId, previousMajor, previousMinor, newMajor, newMinor, changeType, reason, changedById) VALUES (${machineId}, ${previous.majorLetter}, ${previous.minorLetter}, ${next.majorLetter}, ${next.minorLetter}, ${changeType}, ${reason}, ${user.id})`;
  });
  await db.auditLog.create({ data: { userId: user.id, action: "CHANGE_CONFIG", entity: "MachineLotConfig", entityId: String(machineId), details: { previous, next, changeType, reason } } });
  revalidatePath("/commercial-lots");
}
