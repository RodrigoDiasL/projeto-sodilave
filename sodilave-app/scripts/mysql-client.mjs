import "./load-env.mjs";
import mysql from "mysql2/promise";

const rawUrl = String(process.env.DATABASE_URL || "").trim();
if (!rawUrl) throw new Error("DATABASE_URL não está definido.");

const url = new URL(rawUrl);
if (url.protocol !== "mysql:") throw new Error("DATABASE_URL deve usar mysql://.");

export const db = mysql.createPool({
  host: url.hostname || "localhost",
  port: Number(url.port || "3306"),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  waitForConnections: true,
  connectionLimit: 4,
  queueLimit: 0,
  charset: "utf8mb4",
  timezone: "Z",
});

export async function query(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

export async function execute(sql, params = []) {
  const [result] = await db.execute(sql, params);
  return result;
}

export async function closeDb() {
  await db.end();
}

export function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function applySqlFile(filePath, fs) {
  const sql = await fs.readFile(filePath, "utf8");
  for (const statement of splitSqlStatements(sql)) {
    await db.query(statement);
  }
}
