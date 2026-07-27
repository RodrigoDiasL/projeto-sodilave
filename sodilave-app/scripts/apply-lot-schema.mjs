import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL não está definida.");
const sqlPath = path.join(process.cwd(), "prisma", "manual", "2026-07-27-commercial-internal-lots.sql");
const sql = await fs.readFile(sqlPath, "utf8");
const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
try {
  await connection.query(sql);
  console.log("Estrutura de lotes comerciais e controlo interno aplicada com sucesso.");
} finally {
  await connection.end();
}
