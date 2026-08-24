import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const name = String(process.env.RESET_USER_NAME || "").trim();
const pin = String(process.env.RESET_USER_PIN || "").trim();

if (!name) throw new Error("Defina RESET_USER_NAME com o nome exato do utilizador.");
if (!/^\d{8}$/.test(pin)) throw new Error("RESET_USER_PIN deve ter exatamente 8 algarismos.");

try {
  const user = await prisma.user.findFirst({ where: { name } });
  if (!user) throw new Error("Utilizador não encontrado.");

  const others = await prisma.user.findMany({
    where: { id: { not: user.id } },
    select: { pinHash: true },
  });
  for (const other of others) {
    if (await bcrypt.compare(pin, other.pinHash)) throw new Error("O novo PIN já pertence a outro utilizador.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { pinHash: await bcrypt.hash(pin, 12), active: true },
  });
  console.log(`PIN de ${user.name} reposto com sucesso. Remova RESET_USER_PIN do ambiente/comando usado para a recuperação.`);
} finally {
  await prisma.$disconnect();
}
