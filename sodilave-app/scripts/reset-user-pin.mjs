import bcrypt from "bcryptjs";
import { query, execute, closeDb } from "./mysql-client.mjs";

const name = String(process.env.RESET_USER_NAME || "").trim();
const pin = String(process.env.RESET_USER_PIN || "").trim();

if (!name) throw new Error("Defina RESET_USER_NAME com o nome exato do utilizador.");
if (!/^\d{8}$/.test(pin)) throw new Error("RESET_USER_PIN deve ter exatamente 8 algarismos.");

try {
  const users = await query("SELECT id,name,pinHash FROM User WHERE name=? LIMIT 1", [name]);
  const user = users[0];
  if (!user) throw new Error("Utilizador não encontrado.");

  const others = await query("SELECT pinHash FROM User WHERE id<>?", [user.id]);
  for (const other of others) {
    if (await bcrypt.compare(pin, other.pinHash)) throw new Error("O novo PIN já pertence a outro utilizador.");
  }

  await execute(
    "UPDATE User SET pinHash=?, active=1, updatedAt=NOW(3) WHERE id=?",
    [await bcrypt.hash(pin, 12), user.id],
  );
  console.log(`PIN de ${user.name} reposto com sucesso.`);
} finally {
  await closeDb();
}
