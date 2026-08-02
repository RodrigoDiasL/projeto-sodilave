"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

async function requireLotManager() {
  const user = await requireUser();
  if (!["ADMIN", "PRODUCTION_MANAGER"].includes(user.role)) throw new Error("Apenas administradores e o responsável de produção podem gerir lotes.");
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

  const product = await db.product.findFirst({ where: { id: productId, active: true }, select: { id: true } });
  if (!product) throw new Error("O produto selecionado não existe ou está inativo.");

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

  const validMaterials = await db.rawMaterial.count({ where: { id: { in: materials.map((row) => row.rawMaterialId) }, active: true } });
  if (validMaterials !== materials.length) throw new Error("Uma das matérias-primas selecionadas não existe ou está inativa.");

  const year = String(new Date().getFullYear()).slice(-2);
  const code = await db.$transaction(async (tx) => {
    const active = await tx.$queryRaw<{ id: number; code: string }[]>`SELECT id, code FROM CommercialLot WHERE productId=${productId} AND status='ACTIVE' FOR UPDATE`;
    if (active.length) throw new Error(`Já existe o lote comercial ativo ${active[0].code} para este produto. Feche-o antes de criar outro.`);

    const rows = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM CommercialLot WHERE code LIKE ${`L${year}%`} ORDER BY code DESC LIMIT 1 FOR UPDATE`;
    const last = rows[0]?.code?.slice(3) ?? "000";
    const sequence = Number(last) + 1;
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) throw new Error("Foi atingido o limite anual de lotes comerciais.");
    const nextCode = `L${year}${String(sequence).padStart(3, "0")}`;

    await tx.$executeRaw`INSERT INTO CommercialLot (code, productId, status, notes, createdById) VALUES (${nextCode}, ${productId}, 'ACTIVE', ${notes}, ${user.id})`;
    const created = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM CommercialLot WHERE code=${nextCode} LIMIT 1`;
    if (!created[0]) throw new Error("Não foi possível criar o lote comercial.");
    for (const row of materials) {
      await tx.$executeRaw`INSERT INTO CommercialLotMaterial (commercialLotId, rawMaterialId, percentage) VALUES (${created[0].id}, ${row.rawMaterialId}, ${row.percentage})`;
    }
    return nextCode;
  });

  await db.auditLog.create({ data: { userId: user.id, action: "CREATE", entity: "CommercialLot", entityId: code, details: { productId, materials } } });
  revalidatePath("/commercial-lots");
}

export async function closeCommercialLot(fd: FormData) {
  const user = await requireLotManager();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Lote inválido.");
  const affected = await db.$executeRaw`UPDATE CommercialLot SET status='CLOSED', closedAt=NOW(3), closedById=${user.id} WHERE id=${id} AND status='ACTIVE'`;
  if (!affected) throw new Error("O lote comercial não existe ou já se encontra fechado.");
  await db.auditLog.create({ data: { userId: user.id, action: "CLOSE", entity: "CommercialLot", entityId: String(id) } });
  revalidatePath("/commercial-lots");
}

export async function changeMachineLotConfig(fd: FormData) {
  const user = await requireLotManager();
  const machineId = Number(fd.get("machineId"));
  const changeType = String(fd.get("changeType") || "");
  const reason = String(fd.get("reason") || "").trim().slice(0, 2000);
  if (!Number.isInteger(machineId) || machineId <= 0 || !["MAJOR", "MINOR"].includes(changeType) || !reason) throw new Error("Preencha a máquina, o tipo de alteração e o motivo.");

  const machine = await db.machine.findUnique({ where: { id: machineId }, select: { id: true } });
  if (!machine) throw new Error("A máquina selecionada não existe.");

  const change = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ majorLetter: string; minorLetter: string }[]>`SELECT majorLetter, minorLetter FROM MachineLotConfig WHERE machineId=${machineId} FOR UPDATE`;
    const previous = rows[0] ?? { majorLetter: "A", minorLetter: "A" };
    const next = changeType === "MAJOR"
      ? { majorLetter: nextLetter(previous.majorLetter), minorLetter: "A" }
      : { majorLetter: previous.majorLetter, minorLetter: nextLetter(previous.minorLetter) };
    await tx.$executeRaw`INSERT INTO MachineLotConfig (machineId, majorLetter, minorLetter, updatedById) VALUES (${machineId}, ${next.majorLetter}, ${next.minorLetter}, ${user.id}) ON DUPLICATE KEY UPDATE majorLetter=VALUES(majorLetter), minorLetter=VALUES(minorLetter), updatedById=VALUES(updatedById)`;
    await tx.$executeRaw`INSERT INTO MachineLotConfigHistory (machineId, previousMajor, previousMinor, newMajor, newMinor, changeType, reason, changedById) VALUES (${machineId}, ${previous.majorLetter}, ${previous.minorLetter}, ${next.majorLetter}, ${next.minorLetter}, ${changeType}, ${reason}, ${user.id})`;
    return { previous, next };
  });

  await db.auditLog.create({ data: { userId: user.id, action: "CHANGE_CONFIG", entity: "MachineLotConfig", entityId: String(machineId), details: { ...change, changeType, reason } } });
  revalidatePath("/commercial-lots");
}
