import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { db } from "@/lib/db";

export class AuthRateLimitError extends Error {
  constructor() { super("Demasiadas tentativas. Aguarde um minuto antes de tentar novamente."); }
}

// Shared by every process. Reserve BEFORE credential checks/operational transactions:
// invalid credentials and later rollbacks must still consume the attempt.
export async function reserveAuthAttempt(bucket: string, limit: number, windowSeconds = 60) {
  const allowed = await db.$transaction(async tx => {
    await tx.execute(`INSERT INTO AuthRateLimit (bucket, attempts, resetAt)
      VALUES (?, 0, TIMESTAMPADD(SECOND, ?, NOW(3))) ON DUPLICATE KEY UPDATE bucket=VALUES(bucket)`, [bucket, windowSeconds]);
    const affected = await tx.execute(`UPDATE AuthRateLimit SET
      attempts = IF(resetAt <= NOW(3), 1, attempts + 1),
      resetAt = IF(resetAt <= NOW(3), TIMESTAMPADD(SECOND, ?, NOW(3)), resetAt)
      WHERE bucket = ? AND (resetAt <= NOW(3) OR attempts < ?)`, [windowSeconds, bucket, limit]);
    return affected === 1;
  });
  if (!allowed) throw new AuthRateLimitError();
}

export async function reserveLoginAttempt() {
  await reserveAuthAttempt("login:global", 30);
  // Ignore forwarding headers unless the deployment explicitly trusts a proxy
  // that replaces this header and is the only route to the application server.
  const header = process.env.TRUSTED_PROXY_IP_HEADER;
  if (header) {
    const address = (await headers()).get(header)?.trim() ?? "";
    const identity = isIP(address) ? address : "unknown";
    const digest = createHash("sha256").update(identity).digest("hex");
    await reserveAuthAttempt(`login:ip:${digest}`, 10);
  }
  await db.execute("DELETE FROM AuthRateLimit WHERE resetAt < DATE_SUB(NOW(3), INTERVAL 1 DAY) LIMIT 100");
}
