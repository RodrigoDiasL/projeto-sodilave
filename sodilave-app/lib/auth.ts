import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

const COOKIE = "sodilave_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-only-change-me");

type SessionPayload = { userId: number; role: "ADMIN" | "PRODUCTION_MANAGER" | "AUDITOR" | "OPERATOR"; name: string };

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as SessionPayload;
  } catch { return null; }
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) redirect("/login");
  return user;
}

export async function requireOperationalUser() {
  const user = await requireUser();
  if (user.role === "AUDITOR") redirect("/access-denied");
  return user;
}

export async function requireAuditAccess() {
  const user = await requireUser();
  if (!["ADMIN", "AUDITOR"].includes(user.role)) redirect("/access-denied");
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
