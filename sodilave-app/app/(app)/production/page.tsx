import Link from "next/link";
import { ClipboardPlus, FolderOpen, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { getPastProductionEnabled } from "@/lib/operation-settings";
import { ProductionPeriodSelector } from "@/components/ProductionPeriodSelector";

function statusLabel(status: string) {
  return { DRAFT: "Em aberto", FINALIZED: "Finalizada", CANCELLED: "Cancelada" }[status] ?? status;
}

export default async function ProductionPage() {
  const user = await requireUser();
  const [drafts, finalized] = await Promise.all([
    db.production.findMany({
      where: { recordOrigin:"PRODUCTION", status: "DRAFT" },
      include: { machine: true, product: true, operator: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.production.findMany({
      where: { recordOrigin:"PRODUCTION", status: "FINALIZED" },
      include: { machine: true, product: true, operator: true },
      orderBy: { finalizedAt: "desc" },
      take: 20,
    }),
  ]);

  const pastProductionEnabled = user.role !== "AUDITOR" && await getPastProductionEnabled();

  return <>
    <PageIntro title="Produções" subtitle="Inicie uma nova produção ou continue um registo já guardado." />
    {user.role==="ADMIN"&&<Link className="btn secondary" href="/admin/import-history">Importar produções antigas de ficheiro</Link>}
    <ProductionPeriodSelector enabled={pastProductionEnabled}/>
    <section className="production-choice-grid">
      {user.role!=="AUDITOR"&&<Link className="admin-card production-choice" href="/production/new"><ClipboardPlus/><h2>Nova produção</h2><p>Criar um novo registo de produção.</p><span>→</span></Link>}
      <a className="admin-card production-choice" href="#abertas"><FolderOpen/><h2>Produções em aberto</h2><p>{drafts.length} registo(s) por concluir.</p><span>↓</span></a>
      <a className="admin-card production-choice" href="#finalizadas"><CheckCircle2/><h2>Produções finalizadas</h2><p>Consultar os registos mais recentes.</p><span>↓</span></a>
    </section>

    <section className="panel" id="abertas">
      <h2>Produções em aberto</h2>
      {drafts.length === 0 ? <p className="empty-state">Não existem produções em aberto.</p> : <div className="responsive-table"><table><thead><tr><th>Última gravação</th><th>Lote</th><th>Máquina</th><th>Produto</th><th>Operador</th><th>Ação</th></tr></thead><tbody>{drafts.map((row) => <tr key={row.id}><td>{row.updatedAt.toLocaleString("pt-PT")}</td><td>{row.productionLot}</td><td>{row.machine.code}</td><td>{row.product.name}</td><td>{row.operator.name}</td><td><Link className="btn primary" href={user.role==="AUDITOR"?`/admin/productions/${row.id}`:`/production/${row.id}`}>{user.role==="AUDITOR"?"Consultar produção":"Continuar produção"}</Link></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel" id="finalizadas">
      <h2>Produções finalizadas recentemente</h2>
      {finalized.length === 0 ? <p className="empty-state">Ainda não existem produções finalizadas.</p> : <div className="responsive-table"><table><thead><tr><th>Data</th><th>Lote</th><th>Máquina</th><th>Produto</th><th>Quantidade</th><th>Estado</th><th>Ação</th></tr></thead><tbody>{finalized.map((row) => <tr key={row.id}><td>{(row.finalizedAt ?? row.updatedAt).toLocaleString("pt-PT")}</td><td>{row.productionLot}</td><td>{row.machine.code}</td><td>{row.product.name}</td><td>{row.capPackaging?`${Number(row.producedKg).toLocaleString("pt-PT")} kg · ${row.quantityProduced} ${row.capPackaging==="BOX"?"caixas":"caixotes"}`:row.quantityProduced ?? "—"}</td><td>{statusLabel(row.status)}</td><td><Link className="btn secondary" href={`/production/details/${row.id}`}>Ver detalhes</Link></td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
