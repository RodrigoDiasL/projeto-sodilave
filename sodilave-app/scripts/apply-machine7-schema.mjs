import fs from "node:fs/promises";
import path from "node:path";
import { applySqlFile, closeDb } from "./mysql-client.mjs";

try {
  await applySqlFile(path.join(process.cwd(), "database", "migrations", "002-machine7-cavities.sql"), fs);
  console.log("Estrutura da máquina 7 aplicada com sucesso.");
} catch (error) {
  console.error("Não foi possível aplicar a estrutura da máquina 7.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
