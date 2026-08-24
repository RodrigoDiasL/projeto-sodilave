import { PrismaClient } from "@prisma/client";

try {
  const prisma = new PrismaClient();
  await prisma.$disconnect();
  console.log("Prisma Client carregado com sucesso.");
} catch (error) {
  console.error("Falha ao carregar o Prisma Client gerado.");
  console.error(error);
  process.exit(1);
}
