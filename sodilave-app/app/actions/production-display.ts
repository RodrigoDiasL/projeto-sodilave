"use server";
import { randomInt, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayHash } from "@/lib/production-display";

export async function createDisplayDevice(fd: FormData) {
  const user = await requireAdmin();
  const name = String(fd.get("name") ?? "").trim();
  if (!name || name.length > 80) throw new Error("Indique um nome para o ecrã (até 80 caracteres).");
  const code = String(randomInt(10000000, 100000000));
  const id = randomUUID();
  await db.$transaction(async tx => {
    await tx.execute(`INSERT INTO ProductionDisplayDevice (id,name,pairingHash,pairingExpiresAt,createdById)
      VALUES (?,?,?,DATE_ADD(NOW(3),INTERVAL 10 MINUTE),?)`, [id,name,displayHash(code),user.id]);
    await tx.auditLog.create({ data: { userId:user.id,action:"CREATE",entity:"ProductionDisplayDevice",entityId:id,details:{ name } } });
  });
  revalidatePath("/admin/production-display");
  return { code };
}

export async function revokeDisplayDevice(fd: FormData) {
  const user = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Ecrã inválido.");
  await db.$transaction(async tx => {
    await tx.execute("UPDATE ProductionDisplayDevice SET revokedAt=NOW(3),pairingHash=NULL,tokenHash=NULL WHERE id=?", [id]);
    await tx.auditLog.create({ data: { userId:user.id,action:"EDIT",entity:"ProductionDisplayDevice",entityId:id,details:{ revoked:true } } });
  });
  revalidatePath("/admin/production-display");
}

export async function saveDisplayOrder(fd: FormData) {
  const user = await requireAdmin();
  const machineId=Number(fd.get("machineId")), productId=Number(fd.get("productId"));
  const destination=String(fd.get("destination")), notes=String(fd.get("notes") ?? "").trim();
  if (!Number.isSafeInteger(machineId) || machineId<1 || !Number.isSafeInteger(productId) || productId<1 || !["STACK","PALLET"].includes(destination) || notes.length>240) throw new Error("Verifique a máquina, o produto e o destino.");
  await db.$transaction(async tx => {
    const machines=await tx.query<any[]>("SELECT id FROM Machine WHERE id=? AND active=1 FOR UPDATE",[machineId]);
    const cycles=await tx.query<any[]>(`SELECT s.id FROM WeeklyStartup s WHERE s.status='FINALIZED'
      AND NOT EXISTS (SELECT 1 FROM WeeklyShutdown wd WHERE wd.weeklyStartupId=s.id AND wd.status='FINALIZED')
      ORDER BY s.startupDate DESC,s.id DESC LIMIT 1`,[]);
    if (!machines.length || !cycles.length) throw new Error("É necessário um arranque semanal ativo e uma máquina ativa.");
    const products=await tx.query<any[]>(`SELECT p.id FROM Product p
      INNER JOIN ProductMachine pm ON pm.productId=p.id AND pm.machineId=?
      WHERE p.id=? AND p.active=1 FOR UPDATE`,[machineId,productId]);
    if (!products.length) throw new Error("Escolha um produto ativo associado à máquina.");
    await tx.execute(`INSERT INTO MachineDisplayOrder (machineId,weeklyStartupId,productId,commercialLotId,destination,notes,updatedById)
      VALUES (?,?,?,NULL,?,?,?) ON DUPLICATE KEY UPDATE weeklyStartupId=VALUES(weeklyStartupId),productId=VALUES(productId),commercialLotId=NULL,
      destination=VALUES(destination),notes=VALUES(notes),updatedById=VALUES(updatedById),updatedAt=NOW(3)`,[machineId,cycles[0].id,productId,destination,notes,user.id]);
    await tx.auditLog.create({data:{userId:user.id,action:"EDIT",entity:"MachineDisplayOrder",entityId:String(machineId),details:{weeklyStartupId:cycles[0].id,productId,destination,notes}}});
  });
  revalidatePath("/admin/production-display");
}
