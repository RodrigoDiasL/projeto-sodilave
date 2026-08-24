import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

async function coreSchemaExists() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'User'"
  );
  return Number(rows?.[0]?.count ?? 0) > 0;
}

function createCoreSchema() {
  console.log("Base de dados vazia: a criar o schema Prisma inicial...");
  const result = spawnSync(npx, ["prisma", "db", "push", "--skip-generate"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Falhou a criação do schema Prisma inicial.");
}

async function ensureMigrationTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS AppSchemaMigration (
      name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      appliedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (name)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

async function applyManualMigrations() {
  const folder = path.join(process.cwd(), "prisma", "manual");
  const files = (await fs.readdir(folder)).filter((name) => name.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(folder, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = await prisma.$queryRawUnsafe(
      "SELECT checksum FROM AppSchemaMigration WHERE name = ? LIMIT 1",
      file,
    );

    if (existing.length) {
      if (existing[0].checksum !== checksum) {
        throw new Error(`A migração ${file} foi alterada depois de aplicada. Não é seguro continuar.`);
      }
      console.log(`Migração já aplicada: ${file}`);
      continue;
    }

    console.log(`A aplicar migração: ${file}`);
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe(
      "INSERT INTO AppSchemaMigration (name, checksum) VALUES (?, ?)",
      file,
      checksum,
    );
  }
}

async function ensureInitialAdmin() {
  const count = await prisma.user.count();
  if (count > 0) {
    console.log("Já existem utilizadores; não foi criado nenhum administrador inicial.");
    return;
  }

  const name = String(process.env.INITIAL_ADMIN_NAME || "").trim();
  const pin = String(process.env.INITIAL_ADMIN_PIN || "").trim();
  if (!name || !/^\d{8}$/.test(pin)) {
    throw new Error("A base não tem utilizadores. Defina INITIAL_ADMIN_NAME e INITIAL_ADMIN_PIN com um PIN de 8 algarismos antes de continuar.");
  }

  await prisma.user.create({
    data: {
      name: name.slice(0, 120),
      pinHash: await bcrypt.hash(pin, 12),
      role: "ADMIN",
      active: true,
    },
  });
  console.log(`Administrador inicial criado: ${name}. Remova INITIAL_ADMIN_PIN das variáveis do cPanel depois do primeiro arranque.`);
}

try {
  if (!(await coreSchemaExists())) createCoreSchema();
  await ensureMigrationTable();
  await applyManualMigrations();
  await ensureInitialAdmin();
  console.log("Base de dados de produção preparada com sucesso.");
} finally {
  await prisma.$disconnect();
}
