import bcrypt from "bcryptjs";
import { query, execute, closeDb } from "./mysql-client.mjs";

async function ensureDevelopmentAdmin() {
  const rows = await query("SELECT COUNT(*) AS total FROM User");
  if (Number(rows?.[0]?.total ?? 0) > 0) return;

  const name = String(process.env.INITIAL_ADMIN_NAME || "Administrador").trim();
  const pin = String(process.env.INITIAL_ADMIN_PIN || "").trim();
  if (!/^\d{8}$/.test(pin)) {
    throw new Error("A base de desenvolvimento não tem utilizadores. Defina INITIAL_ADMIN_PIN com 8 algarismos para criar o primeiro administrador.");
  }
  await execute(
    "INSERT INTO User (name,pinHash,role,active,createdAt,updatedAt) VALUES (?,?, 'ADMIN',1,NOW(3),NOW(3))",
    [name.slice(0,120), await bcrypt.hash(pin,12)],
  );
}

async function main() {
  await ensureDevelopmentAdmin();

  for (const code of ["1","2","3","4","5","6","7"]) {
    await execute(
      "INSERT INTO Machine (code,name,active,status,statusChangedAt,createdAt,updatedAt) VALUES (?,?,1,'STOPPED',NOW(3),NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE name=VALUES(name)",
      [code, `Máquina ${code}`],
    );
  }

  const products = [
    ["GAR-05-HDPE","Garrafão 5 L HDPE","Jerrycan"],
    ["GAR-10-HDPE","Garrafão 10 L HDPE","Jerrycan"],
    ["GAR-20-HDPE","Garrafão 20 L HDPE","Jerrycan"],
  ];
  for (const [code,name,packageType] of products) {
    await execute(
      "INSERT INTO Product (code,name,packageType,active,createdAt,updatedAt) VALUES (?,?,?,1,NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE name=VALUES(name),packageType=VALUES(packageType)",
      [code,name,packageType],
    );
  }

  const materials = [
    ["PEAD-NAT","PEAD Natural"],
    ["PEAD-REC","PEAD Reciclado"],
    ["MB-AZUL","Masterbatch Azul"],
  ];
  for (const [code,name] of materials) {
    await execute(
      "INSERT INTO RawMaterial (code,name,unit,active,createdAt,updatedAt) VALUES (?,?,'kg',1,NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE name=VALUES(name)",
      [code,name],
    );
  }

  const rules = await query("SELECT id FROM ProductionLotRule LIMIT 1");
  if (!rules.length) {
    await execute(
      "INSERT INTO ProductionLotRule (name,prefix,template,active,createdAt,updatedAt) VALUES ('Regra principal','SD','{PREFIX}-{YY}{WW}-{SHIFT}-{MACHINE}-{SEQ}',1,NOW(3),NOW(3))",
    );
  }

  console.log("Dados de desenvolvimento preparados.");
}

try {
  await main();
} finally {
  await closeDb();
}
