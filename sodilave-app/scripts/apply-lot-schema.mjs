import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const sqlFiles = [
  "2026-07-27-commercial-internal-lots.sql",
  "2026-08-03-production-stock-ledger.sql",
];

try {
  for (const file of sqlFiles) {
    const sqlPath = path.join(process.cwd(), "prisma", "manual", file);
    const sql = await fs.readFile(sqlPath, "utf8");
    const statements = sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  }
  console.log("Estrutura de lotes, controlo interno e movimentos de stock aplicada com sucesso.");
} finally {
  await prisma.$disconnect();
}
