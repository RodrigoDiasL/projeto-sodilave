import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const mappings = [
  ["Rodrigo", "1234", "00001234"],
  ["Ana", "4321", "00004321"],
  ["Emídio", "1111", "00001111"],
  ["Miguel", "1112", "00001112"],
  ["Nuno", "1113", "00001113"],
  ["Rafael", "1114", "00001114"],
  ["Hugo", "1115", "00001115"],
  ["Luís", "1116", "00001116"],
  ["Claudio", "1117", "00001117"],
  ["Olga", "0000", "00000000"],
];

try {
  for (const [name, oldPin, newPin] of mappings) {
    const user = await prisma.user.findFirst({ where: { name }, select: { id: true, pinHash: true } });
    if (!user) continue;
    if (await bcrypt.compare(newPin, user.pinHash)) {
      console.log(`${name}: já usa o PIN de 8 dígitos.`);
      continue;
    }
    if (!(await bcrypt.compare(oldPin, user.pinHash))) {
      console.log(`${name}: PIN atual foi alterado anteriormente; não foi modificado.`);
      continue;
    }
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: await bcrypt.hash(newPin, 12) } });
    console.log(`${name}: PIN inicial convertido para 8 dígitos.`);
  }
} finally {
  await prisma.$disconnect();
}
