import { db } from "@/lib/db";
import { requireAuditAccess } from "@/lib/auth";
import { AdminPage } from "@/components/AdminPage";

const resultLabel = (value: string | null) => value ? ({ CONFORMING: "Conforme", NON_CONFORMING: "Não conforme", NOT_APPLICABLE: "Não aplicável", NOT_PERFORMED: "Não realizado" }[value] ?? value) : "—";
export default async function Page() {
  await requireAuditAccess();
  const rows = await db.weeklyStartup.findMany({ include: { operator: true, machines: { include: { machine: true } } }, orderBy: { startupDate: "desc" }, take: 100 });
  return <AdminPage title="Arranques semanais" subtitle="Consultar os arranques, as máquinas selecionadas e as verificações efetuadas.">
    {rows.length === 0 ? <p className="empty-state">Ainda não existem arranques semanais.</p> : <div className="startup-history">{rows.map((row) => <details className="panel startup-record" key={row.id}><summary><strong>{row.startupDate.toLocaleDateString("pt-PT")}</strong> · Turno {row.shiftCode} · {row.status === "FINALIZED" ? "Finalizado" : "Rascunho"} · {row.operator.name}</summary>
      <div className="two-col startup-details"><div><h3>Máquinas em funcionamento</h3><p>{row.machines.map((item:any) => item.machine.code).join(", ") || "Nenhuma"}</p><h3>Equipamentos</h3><p>Refrigerador pequeno: {row.chillerSmall ? "Sim" : "Não"}<br/>Refrigerador grande: {row.chillerLarge ? "Sim" : "Não"}<br/>Bomba de refrigeração: {row.coolingPump ? "Sim" : "Não"}<br/>Compressor: {row.compressor ? "Sim" : "Não"}<br/>Secadores de ar: {row.airDryers ? "Sim" : "Não"}<br/>Desmoleculizador: {row.airDemolecularizer ? "Sim" : "Não"}</p></div><div><h3>Verificações gerais</h3><p>Produção: {resultLabel(row.productionWindows)}<br/>Armazenamento: {resultLabel(row.storageWindows)}<br/>Expedição: {resultLabel(row.dispatchWindows)}<br/>Empilhador: {resultLabel(row.forkliftIntegrity)}<br/>Iluminação de emergência: {resultLabel(row.emergencyLighting)}</p><h3>Observações</h3><p>{row.observations || "—"}</p></div></div>
      <div className="responsive-table"><table><thead><tr><th>Máquina</th><th>Acrílicos</th><th>Tabuleiros</th><th>Iluminação</th><th>Temperaturas</th><th>Lubrificação</th><th>Molde</th><th>Tapetes/aparadeiras</th><th>Filtros</th></tr></thead><tbody>{row.machines.map((item:any) => <tr key={item.id}><td>{item.machine.code}</td><td>{resultLabel(item.acrylics)}</td><td>{resultLabel(item.plasticTrays)}</td><td>{resultLabel(item.lighting)}</td><td>{resultLabel(item.extruderTemperatures)}</td><td>{resultLabel(item.lubrication)}</td><td>{resultLabel(item.mouldCleaning)}</td><td>{resultLabel(item.beltsTraysTables)}</td><td>{resultLabel(item.waterFilters)}</td></tr>)}</tbody></table></div>
    </details>)}</div>}
  </AdminPage>;
}
