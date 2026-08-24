"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";

export async function loginAction(_: { error?: string } | undefined, formData: FormData) {
  const pin = String(formData.get("pin") || "").trim();
  if (!/^\d{8}$/.test(pin)) return { error: "Introduza um PIN válido de 8 algarismos." };
  const users = await db.user.findMany({ where: { active: true } });
  for (const user of users) {
    if (await bcrypt.compare(pin, user.pinHash)) {
      await createSession({ userId: user.id, role: user.role, name: user.name });
      redirect("/dashboard");
    }
  }
  return { error: "PIN incorreto." };
}

export async function logoutAction() { await destroySession(); redirect("/login"); }
