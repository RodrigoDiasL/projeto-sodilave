import bcrypt from "bcryptjs";
import { db, closeDb } from "./mysql-client.mjs";

const name = String(process.env.RESET_USER_NAME || "").trim();
const pin = String(process.env.RESET_USER_PIN || "").trim();

if (!name) throw new Error("Defina RESET_USER_NAME com o nome exato do utilizador.");
if (!/^\d{8}$/.test(pin)) throw new Error("RESET_USER_PIN deve ter exatamente 8 algarismos.");

const connection = await db.getConnection();
try {
  await connection.beginTransaction();
  await connection.query("SELECT id FROM CredentialLock WHERE id=1 FOR UPDATE");
  const [users] = await connection.execute("SELECT id,name,pinHash FROM User WHERE name=? LIMIT 2", [name]);
  if (users.length !== 1) throw new Error("O nome deve identificar exatamente um utilizador.");
  const user = users[0];
  const [others] = await connection.execute("SELECT pinHash FROM User WHERE id<>?", [user.id]);
  for (const other of others) {
    if (await bcrypt.compare(pin, other.pinHash)) throw new Error("O novo PIN já pertence a outro utilizador.");
  }
  await connection.execute("UPDATE User SET pinHash=?, active=1, sessionVersion=sessionVersion+1, updatedAt=NOW(3) WHERE id=?", [await bcrypt.hash(pin, 12), user.id]);
  await connection.execute("DELETE FROM AuthSession WHERE userId=?", [user.id]);
  await connection.execute("DELETE FROM ShiftPeerConfirmation WHERE operatorId=? OR confirmedById=?", [user.id, user.id]);
  await connection.execute("INSERT INTO AuditLog (action,entity,entityId,details) VALUES ('RESET_PIN','User',?,?)", [String(user.id), JSON.stringify({ source: "reset-user-pin script", sessionsRevoked: true })]);
  await connection.commit();
  console.log(`PIN de ${user.name} reposto; sessões anteriores terminadas.`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await closeDb();
}
