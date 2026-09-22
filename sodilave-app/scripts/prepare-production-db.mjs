import { tableNameKey } from "./schema-identifiers.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, query, execute, closeDb, splitSqlStatements } from "./mysql-client.mjs";

async function databaseState() {
  const [server] = await query("SELECT DATABASE() AS databaseName, @@lower_case_table_names AS lowerCaseTableNames");
  const rows = await query("SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema=DATABASE()");
  const normalize = name => tableNameKey(name,server.lowerCaseTableNames);
  console.log(`Base de dados: ${server.databaseName} (lower_case_table_names=${server.lowerCaseTableNames}).`);
  return {
    totalTables: rows.length,
    hasUserTable: rows.some(row=>normalize(row.tableName)===normalize("User")),
  };
}

async function applySqlText(sql) {
  for (const statement of splitSqlStatements(sql)) {
    await db.query(statement);
  }
}

async function createCoreSchema() {
  console.log("Base de dados vazia: a criar o schema SQL inicial...");
  const sql = await fs.readFile(path.join(process.cwd(), "database", "001-core.sql"), "utf8");
  await applySqlText(sql);
}

async function ensureMigrationTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS AppSchemaMigration (
      name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      appliedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (name)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

async function applyMigrations() {
  const folder = path.join(process.cwd(), "database", "migrations");
  const files = (await fs.readdir(folder)).filter((name) => name.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(folder, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = await query(
      "SELECT checksum FROM AppSchemaMigration WHERE name = ? LIMIT 1",
      [file],
    );

    if (existing.length) {
      if (existing[0].checksum !== checksum) {
        throw new Error(`A migração ${file} foi alterada depois de aplicada. Não é seguro continuar.`);
      }
      console.log(`Migração já aplicada: ${file}`);
      continue;
    }

    console.log(`A aplicar migração: ${file}`);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of splitSqlStatements(sql)) await connection.query(statement);
      await connection.execute(
        "INSERT INTO AppSchemaMigration (name, checksum) VALUES (?, ?)",
        [file, checksum],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

async function ensureInitialAdmin() {
  const rows = await query("SELECT COUNT(*) AS total FROM User");
  if (Number(rows?.[0]?.total ?? 0) > 0) {
    console.log("Já existem utilizadores; não foi criado nenhum administrador inicial.");
    return;
  }

  const name = String(process.env.INITIAL_ADMIN_NAME || "").trim();
  const pin = String(process.env.INITIAL_ADMIN_PIN || "").trim();
  if (!name || !/^\d{8}$/.test(pin)) {
    throw new Error("A base não tem utilizadores. Defina INITIAL_ADMIN_NAME e INITIAL_ADMIN_PIN com um PIN de 8 algarismos antes de continuar.");
  }

  await execute(
    "INSERT INTO User (name, pinHash, role, active, createdAt, updatedAt) VALUES (?, ?, 'ADMIN', 1, NOW(3), NOW(3))",
    [name.slice(0, 120), await bcrypt.hash(pin, 12)],
  );
  console.log(`Administrador inicial criado: ${name}. Remova INITIAL_ADMIN_PIN das variáveis do servidor depois da primeira execução.`);
}

try {
  const state = await databaseState();
  if (!state.hasUserTable) {
    if (state.totalTables > 0) {
      throw new Error("A base de dados não está vazia, mas não contém o schema esperado da Sodilave. Por segurança, a instalação foi interrompida.");
    }
    await createCoreSchema();
  }
  await ensureMigrationTable();
  await applyMigrations();
  await ensureInitialAdmin();
  console.log("Base de dados de produção preparada com sucesso.");
} finally {
  await closeDb();
}
