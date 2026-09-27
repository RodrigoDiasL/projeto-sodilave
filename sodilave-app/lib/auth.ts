import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE = IS_PRODUCTION ? "__Host-sodilave_session" : "sodilave_session";
const configuredSecret = process.env.SESSION_SECRET;
if (IS_PRODUCTION && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error("SESSION_SECRET é obrigatório em produção e deve ter pelo menos 32 caracteres.");
}
const development = globalThis as typeof globalThis & { sodilaveDevSecret?: string };
const secret = new TextEncoder().encode(configuredSecret || (development.sodilaveDevSecret ??= randomBytes(32).toString("hex")));
const issuer = "sodilave";
const audience = "sodilave-session";
type SessionUser = { id: number; name: string; role: "ADMIN" | "PRODUCTION_MANAGER" | "AUDITOR" | "OPERATOR" | "LOGISTICS"; active: number | boolean; sessionVersion: number };
type LoginUser = { userId: number; role: string; name: string };

export async function createSession(payload: LoginUser, expectedPinHash: string) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const user = await db.$transaction(async tx => {
    const rows = await tx.query<SessionUser[]>("SELECT id,name,role,active,sessionVersion FROM User WHERE id=? AND pinHash=? FOR UPDATE", [payload.userId, expectedPinHash]);
    const current = rows[0];
    if (!current?.active) throw new Error("As credenciais foram alteradas. Inicie sessão novamente.");
    await tx.execute("INSERT INTO AuthSession (id,userId,sessionVersion,expiresAt) VALUES (?,?,?,?)", [sessionId, current.id, current.sessionVersion, expiresAt]);
    return current;
  });
  await db.execute("DELETE FROM AuthSession WHERE expiresAt <= NOW(3) LIMIT 100");
  const token = await new SignJWT({ userId: user.id, sessionVersion: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" }).setJti(sessionId).setIssuer(issuer).setAudience(audience)
    .setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(secret);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: IS_PRODUCTION, path: "/", maxAge: 12 * 60 * 60, priority: "high" });
}

async function verifiedToken() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], issuer, audience, requiredClaims: ["exp", "iat", "jti", "userId", "sessionVersion"], maxTokenAge: "12h" });
    if (!Number.isInteger(payload.userId) || Number(payload.userId) <= 0 || !Number.isInteger(payload.sessionVersion) || typeof payload.jti !== "string") return null;
    return payload;
  } catch { return null; }
}

export async function destroySession() {
  const payload = await verifiedToken();
  try {
    if (payload) await db.execute("DELETE FROM AuthSession WHERE id=? AND userId=?", [payload.jti, payload.userId]);
  } finally { (await cookies()).delete(COOKIE); }
}

export async function getSession(): Promise<SessionUser | null> {
  const payload = await verifiedToken();
  if (!payload) return null;
  const rows = await db.query<SessionUser[]>(`SELECT u.id,u.name,u.role,u.active,u.sessionVersion
    FROM AuthSession s INNER JOIN User u ON u.id=s.userId
    WHERE s.id=? AND s.userId=? AND s.sessionVersion=? AND u.sessionVersion=s.sessionVersion
      AND u.active=1 AND s.expiresAt>NOW(3) LIMIT 1`, [payload.jti, payload.userId, payload.sessionVersion]);
  return rows[0] ?? null;
}

export async function requireUser() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}
export async function requireOperationalUser() {
  const user = await requireUser();
  if (!["ADMIN", "PRODUCTION_MANAGER", "OPERATOR", "LOGISTICS"].includes(user.role)) redirect("/access-denied");
  return user;
}
export async function requireAuditAccess() {
  const user = await requireUser();
  if (!["ADMIN", "AUDITOR"].includes(user.role)) redirect("/access-denied");
  return user;
}
export async function requireReadAccess() {
  const user = await requireUser();
  if (!["ADMIN", "PRODUCTION_MANAGER", "AUDITOR"].includes(user.role)) redirect("/access-denied");
  return user;
}
export async function requireProductionManager() {
  const user = await requireUser();
  if (!["ADMIN", "PRODUCTION_MANAGER"].includes(user.role)) redirect("/access-denied");
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/access-denied");
  return user;
}

export async function requireCommerceUser() {
  const user = await requireUser();
  if (!["ADMIN", "PRODUCTION_MANAGER", "LOGISTICS"].includes(user.role)) redirect("/access-denied");
  return user;
}
export async function requireCommerceReadAccess() {
  const user = await requireUser();
  if (!["ADMIN", "PRODUCTION_MANAGER", "LOGISTICS", "AUDITOR"].includes(user.role)) redirect("/access-denied");
  return user;
}
