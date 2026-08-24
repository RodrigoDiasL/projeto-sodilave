import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const users = [
  { name: "Rodrigo", pin: "00001234", role: UserRole.ADMIN },
  { name: "Ana", pin: "00004321", role: UserRole.ADMIN },
  { name: "Emídio", pin: "00001111", role: UserRole.OPERATOR },
  { name: "Miguel", pin: "00001112", role: UserRole.OPERATOR },
  { name: "Nuno", pin: "00001113", role: UserRole.OPERATOR },
  { name: "Rafael", pin: "00001114", role: UserRole.OPERATOR },
  { name: "Hugo", pin: "00001115", role: UserRole.OPERATOR },
  { name: "Luís", pin: "00001116", role: UserRole.PRODUCTION_MANAGER },
  { name: "Claudio", pin: "00001117", role: UserRole.OPERATOR },
  { name: "Olga", pin: "00000000", role: UserRole.AUDITOR },
];

async function disableOrRemoveDemoUser(name: string) {
  const row = await prisma.user.findFirst({ where: { name } });
  if (!row) return;
  const references = await Promise.all([
    prisma.production.count({ where: { operatorId: row.id } }),
    prisma.machineCheckup.count({ where: { operatorId: row.id } }),
    prisma.shiftGeneralCheck.count({ where: { operatorId: row.id } }),
    prisma.auditLog.count({ where: { userId: row.id } }),
  ]);
  if (references.some(Boolean)) await prisma.user.update({ where: { id: row.id }, data: { active: false } });
  else await prisma.user.delete({ where: { id: row.id } });
}

async function main() {
  await disableOrRemoveDemoUser("Administrador");
  await disableOrRemoveDemoUser("Operador Demo");

  for (const user of users) {
    const existing = await prisma.user.findFirst({ where: { name: user.name } });
    const data = { pinHash: await bcrypt.hash(user.pin, 12), role: user.role, active: true };
    if (existing) await prisma.user.update({ where: { id: existing.id }, data });
    else await prisma.user.create({ data: { name: user.name, ...data } });
  }

  for (const code of ["1", "2", "3", "4", "5", "6", "7"]) {
    await prisma.machine.upsert({ where: { code }, update: {}, create: { code, name: `Máquina ${code}` } });
  }

  const products = [
    ["GAR-05-HDPE", "Garrafão 5 L HDPE", "Jerrycan"],
    ["GAR-10-HDPE", "Garrafão 10 L HDPE", "Jerrycan"],
    ["GAR-20-HDPE", "Garrafão 20 L HDPE", "Jerrycan"],
  ];
  for (const [code, name, packageType] of products) {
    await prisma.product.upsert({ where: { code }, update: {}, create: { code, name, packageType } });
  }

  const materials = [
    ["PEAD-NAT", "PEAD Natural"],
    ["PEAD-REC", "PEAD Reciclado"],
    ["MB-AZUL", "Masterbatch Azul"],
  ];
  for (const [code, name] of materials) {
    await prisma.rawMaterial.upsert({ where: { code }, update: {}, create: { code, name } });
  }

  const rule = await prisma.productionLotRule.findFirst();
  if (!rule) await prisma.productionLotRule.create({ data: { name: "Regra principal" } });
}

main().finally(() => prisma.$disconnect());
