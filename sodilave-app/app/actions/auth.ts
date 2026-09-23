"use server";
import { AuthRateLimitError, reserveLoginAttempt } from "@/lib/auth-rate-limit";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";

export async function loginAction(_: { error?: string } | undefined, formData: FormData) {
  const pin = String(formData.get("pin") || "").trim();
  if (!/^\d{8}$/.test(pin)) return { error: "Introduza um PIN válido de 8 algarismos." };

  try { await reserveLoginAttempt(); }
  catch (error) {
    if (error instanceof AuthRateLimitError) return { error: error.message };
    console.error("[sodilave] controlo de autenticação indisponível");
    return { error: "Não foi possível iniciar sessão. Tente novamente dentro de instantes." };
  }
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true, pinHash: true } });
  const matches = [];
  for (const user of users) {
    if (await bcrypt.compare(pin, user.pinHash)) matches.push(user);
  }

  if (matches.length > 1) {
    console.error(`[sodilave] PIN duplicado detetado em ${matches.length} contas ativas.`);
    return { error: "Existe um conflito de credenciais. Contacte um administrador." };
  }
  if (matches.length === 1) {
    const user = matches[0];
    await createSession({ userId: user.id, role: user.role, name: user.name }, user.pinHash);
    redirect("/dashboard");
  }
  return { error: "PIN incorreto." };
}

export async function logoutAction() { await destroySession(); redirect("/login"); }
