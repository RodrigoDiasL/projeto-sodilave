import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { reserveAuthAttempt } from "@/lib/auth-rate-limit";
import { formatProductionLot } from "@/lib/lot";
import { getShiftWindow } from "@/lib/shift";

export const displayCookie = process.env.NODE_ENV === "production" ? "__Host-sodilave_display" : "sodilave_display";
export const displayHash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function getDisplayDevice() {
  const token = (await cookies()).get(displayCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await db.query<{ id: string; name: string }[]>(`SELECT id,name FROM ProductionDisplayDevice
    WHERE tokenHash=? AND revokedAt IS NULL AND expiresAt>NOW(3)`, [displayHash(token)]);
  return rows[0] ?? null;
}

export async function pairDisplay(code: string) {
  await reserveAuthAttempt("display:pair", 10);
  if (!/^\d{8}$/.test(code)) throw new Error("Código inválido ou expirado.");
  const token = randomBytes(32).toString("hex");
  const paired = await db.execute(`UPDATE ProductionDisplayDevice SET tokenHash=?, expiresAt=DATE_ADD(NOW(3), INTERVAL 90 DAY), pairingHash=NULL
    WHERE pairingHash=? AND pairingExpiresAt>NOW(3) AND tokenHash IS NULL AND revokedAt IS NULL`, [displayHash(token), displayHash(code)]);
  if (paired !== 1) throw new Error("Código inválido ou expirado.");
  (await cookies()).set(displayCookie, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 90 * 86400 });
}

export type DisplayMachine = {
  id: number; code: string; product: string | null; lot: string | null;
  lotState: "REGISTERED" | "PLANNED" | "MISSING";
  destination: "PALLET" | "STACK" | null; notes: string; warning: string | null;
};
export type DisplayData = { generatedAt: string; validUntil: string; shift: string; cycleActive: boolean; machines: DisplayMachine[] };

// One SQL snapshot keeps machine, weekly cycle, order and current-shift record consistent.
export async function getProductionDisplayData(now = new Date()): Promise<DisplayData> {
  const shift = getShiftWindow(now);
  const rows = await db.query<any[]>(`SELECT m.id,m.code,m.status,m.active,s.id AS startupId,
    o.productId AS orderProductId,o.destination,o.notes,pr.code AS productCode,pr.name AS productName,pr.active AS productActive,
    pm.productId AS assignedProductId,cfg.majorLetter,cfg.minorLetter,p.id AS productionId,p.productId,p.productionLot,
    actualCfg.majorLetter AS actualMajor,actualCfg.minorLetter AS actualMinor,
    pp.code AS actualProductCode,pp.name AS actualProductName,pa.labelCode
    FROM Machine m
    LEFT JOIN WeeklyStartup s ON s.id=(SELECT ws.id FROM WeeklyStartup ws
      WHERE ws.status='FINALIZED' AND NOT EXISTS (SELECT 1 FROM WeeklyShutdown wd WHERE wd.weeklyStartupId=ws.id AND wd.status='FINALIZED')
      ORDER BY ws.startupDate DESC,ws.id DESC LIMIT 1)
    LEFT JOIN MachineDisplayOrder o ON o.machineId=m.id AND o.weeklyStartupId=s.id
    LEFT JOIN Product pr ON pr.id=o.productId
    LEFT JOIN ProductMachine pm ON pm.productId=pr.id AND pm.machineId=m.id
    LEFT JOIN ProductLotConfig cfg ON cfg.productId=pr.id
    LEFT JOIN Production p ON p.id=(SELECT p2.id FROM Production p2 WHERE p2.recordOrigin='PRODUCTION' AND p2.machineId=m.id
      AND (o.productId IS NULL OR p2.productId=o.productId)
      AND p2.status<>'CANCELLED' AND p2.startedAt>=? AND p2.startedAt<?
      AND p2.startedAt>=COALESCE(s.finalizedAt,s.startupDate)
      ORDER BY p2.startedAt DESC,p2.id DESC LIMIT 1)
    LEFT JOIN Product pp ON pp.id=p.productId
    LEFT JOIN ProductLotConfig actualCfg ON actualCfg.productId=p.productId
    LEFT JOIN ProductionLotAssociation pa ON pa.productionId=p.id
    WHERE m.active=1 ORDER BY CAST(m.code AS UNSIGNED),m.code`, [shift.start, shift.end]);
  const cycleActive = rows.some(row => row.startupId != null);
  const machines: DisplayMachine[] = rows.filter(row => row.startupId && row.status === "RUNNING").map(row => {
    const orderValid = Boolean(row.orderProductId && row.productActive && row.assignedProductId);
    const prefix = orderValid
      ? { majorLetter: row.majorLetter ?? "A", minorLetter: row.minorLetter ?? "A" }
      : { majorLetter: row.actualMajor ?? "A", minorLetter: row.actualMinor ?? "A" };
    const internal = formatProductionLot(String(row.code), shift.code, shift.start, prefix);
    // The selected product takes precedence after a mould change. A changed
    // prefix previews the next lot without rewriting a previously saved record.
    const currentProduction = Boolean(row.productionId && row.productionLot === internal && (!row.orderProductId || orderValid));
    return {
      id: row.id, code: row.code,
      product: currentProduction ? `${row.actualProductCode} — ${row.actualProductName}` : orderValid ? `${row.productCode} — ${row.productName}` : null,
      lot: currentProduction ? row.labelCode ?? row.productionLot : orderValid ? internal : null,
      lotState: currentProduction ? "REGISTERED" : orderValid ? "PLANNED" : "MISSING",
      destination: orderValid ? row.destination : null, notes: orderValid ? row.notes : "",
      warning: orderValid ? null : row.orderProductId ? "Ordem desatualizada. Confirmar com o responsável." : "Falta definir a ordem de paletização.",
    };
  });
  return { generatedAt: now.toISOString(), validUntil: shift.end.toISOString(), shift: `${shift.label} · ${shift.hours}`, cycleActive, machines };
}
