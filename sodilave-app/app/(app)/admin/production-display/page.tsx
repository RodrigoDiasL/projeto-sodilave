import { getProductionDisplayData } from "@/lib/production-display";
import { requireAuditAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveWeeklyStartup } from "@/lib/active-machines";
import { AdminPage } from "@/components/AdminPage";
import { DisplayAdmin } from "@/components/DisplayAdmin";
export default async function DisplaySettingsPage() {
  const user=await requireAuditAccess();
  if(user.role==="AUDITOR") {
    const data=await getProductionDisplayData();
    return <AdminPage title="Ecrã de produção — consulta" subtitle="Lotes e instruções atuais, sem permissões para alterar ordens ou emparelhar dispositivos.">
      <p>{data.cycleActive?"Ciclo semanal ativo":"Sem ciclo ativo"} · {data.shift}</p>
      {data.machines.map(m=><section className="panel" key={m.id}><h2>Máquina {m.code}</h2><p>{m.product||"Produto por confirmar"} · {m.lot||"Lote por confirmar"}</p><p>{m.destination==="PALLET"?"Paletes":m.destination==="STACK"?"Estiba / monte":"Destino por confirmar"}</p><p>{m.notes}</p><p>{m.warning}</p></section>)}
    </AdminPage>;
  }
  const startup=await getActiveWeeklyStartup();
  const [machines,lots,rows]=await Promise.all([
    db.query<any[]>(`SELECT m.id,m.code,o.commercialLotId,o.destination,o.notes,COALESCE(o.weeklyStartupId=?,0) AS currentOrder
      FROM Machine m LEFT JOIN MachineDisplayOrder o ON o.machineId=m.id WHERE m.active=1 ORDER BY CAST(m.code AS UNSIGNED),m.code`,[startup?.id??0]),
    db.query<any[]>(`SELECT cl.id,cl.code,CONCAT(p.code,' — ',p.name) AS product,pm.machineId FROM CommercialLot cl
      INNER JOIN Product p ON p.id=cl.productId INNER JOIN ProductMachine pm ON pm.productId=p.id WHERE cl.status='ACTIVE' AND p.active=1 ORDER BY p.code,cl.code`),
    db.query<any[]>(`SELECT id,name,tokenHash IS NOT NULL AS paired,expiresAt,pairingExpiresAt FROM ProductionDisplayDevice
      WHERE revokedAt IS NULL AND (expiresAt>NOW(3) OR (tokenHash IS NULL AND pairingExpiresAt>NOW(3))) ORDER BY createdAt DESC`),
  ]);
  const devices=rows.map(row=>({...row,paired:Boolean(row.paired),expiresAt:row.expiresAt?.toISOString()??null,pairingExpiresAt:row.pairingExpiresAt.toISOString()}));
  return <AdminPage title="Ecrã de produção" subtitle="Lotes, ordens de paletização e ligação de monitores."><DisplayAdmin machines={machines} lots={lots} devices={devices} cycleActive={Boolean(startup)}/></AdminPage>;
}
