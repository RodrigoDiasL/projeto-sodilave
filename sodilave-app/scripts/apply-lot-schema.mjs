import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const sqlPath = path.join(process.cwd(), "prisma", "manual", "2026-07-27-commercial-internal-lots.sql");
const sql = await fs.readFile(sqlPath, "utf8");
const statements = sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean);
try {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  console.log("Estrutura de lotes comerciais e controlo interno aplicada com sucesso.");
} finally {
  await prisma.$disconnect();
}
