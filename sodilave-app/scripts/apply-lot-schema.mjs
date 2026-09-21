import fs from "node:fs/promises";
import path from "node:path";
import { applySqlFile, closeDb } from "./mysql-client.mjs";

const sqlFiles = [
  "003-commercial-internal-lots.sql",
  "004-production-stock-ledger.sql",
];

try {
  for (const file of sqlFiles) {
    await applySqlFile(path.join(process.cwd(), "database", "migrations", file), fs);
  }
  console.log("Estrutura de lotes, controlo interno e movimentos de stock aplicada com sucesso.");
} finally {
  await closeDb();
}
