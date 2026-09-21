import Link from "next/link";
import { ClipboardPlus, FolderOpen, CheckCircle2, CalendarDays } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { formatLocalDateInput } from "@/lib/shift";

function statusLabel(status: string) {
  return { DRAFT: "Em aberto", FINALIZED: "Finalizada", CANCELLED: "Cancelada" }[status] ?? status;
}

export default async function ProductionPage() {
  const user = await requireUser();
  const [drafts, finalized] = await Promise.all([
    db.production.findMany({
      where: { status: "DRAFT" },
      include: { machine: true, product: true, operator: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.production.findMany({
      where: { status: "FINALIZED" },
      include: { machine: true, product: true, operator: true },
      orderBy: { finalizedAt: "desc" },
      take: 20,
    }),
  ]);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const todayText = formatLocalDateInput();
  const yesterdayText = formatLocalDateInput(yesterday);

  return <>
    <PageIntro title="Produções" subtitle="Inicie uma nova produção ou continue um registo já guardado." />
    {user.role === "ADMIN" && <section className="panel form-stack historical-production-panel" id="historica">
      <div><h2>Introduzir produção de outra data</h2><p className="muted">Uso administrativo para registar produções anteriores à entrada em funcionamento da aplicação. É permitida apenas uma produção normal por máquina, data e turno.</p></div>
      <form action="/production/new" method="get" className="inline-form">
        <label>Data<input type="date" name="date" defaultValue={yesterdayText} max={todayText} required/></label>
        <label>Turno<select name="shift" defaultValue="A"><option value="A">Turno A · 00:00–08:00</option><option value="B">Turno B · 08:00–16:00</option><option value="C">Turno C · 16:00–24:00</option></select></label>
        <button className="btn primary" type="submit"><CalendarDays/>Preencher produção histórica</button>
      </form>
    </section>}
    <section className="production-choice-grid">
      <Link className="admin-card production-choice" href="/production/new"><ClipboardPlus/><h2>Nova produção</h2><p>Criar um novo registo de produção.</p><span>→</span></Link>
      <a className="admin-card production-choice" href="#abertas"><FolderOpen/><h2>Produções em aberto</h2><p>{drafts.length} registo(s) por concluir.</p><span>↓</span></a>
      <a className="admin-card production-choice" href="#finalizadas"><CheckCircle2/><h2>Produções finalizadas</h2><p>Consultar os registos mais recentes.</p><span>↓</span></a>
    </section>

    <section className="panel" id="abertas">
      <h2>Produções em aberto</h2>
      {drafts.length === 0 ? <p className="empty-state">Não existem produções em aberto.</p> : <div className="responsive-table"><table><thead><tr><th>Última gravação</th><th>Lote</th><th>Máquina</th><th>Produto</th><th>Operador</th><th>Ação</th></tr></thead><tbody>{drafts.map((row) => <tr key={row.id}><td>{row.updatedAt.toLocaleString("pt-PT")}</td><td>{row.productionLot}</td><td>{row.machine.code}</td><td>{row.product.name}</td><td>{row.operator.name}</td><td><Link className="btn primary" href={`/production/${row.id}`}>Continuar produção</Link></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel" id="finalizadas">
      <h2>Produções finalizadas recentemente</h2>
      {finalized.length === 0 ? <p className="empty-state">Ainda não existem produções finalizadas.</p> : <div className="responsive-table"><table><thead><tr><th>Data</th><th>Lote</th><th>Máquina</th><th>Produto</th><th>Quantidade</th><th>Estado</th><th>Ação</th></tr></thead><tbody>{finalized.map((row) => <tr key={row.id}><td>{(row.finalizedAt ?? row.updatedAt).toLocaleString("pt-PT")}</td><td>{row.productionLot}</td><td>{row.machine.code}</td><td>{row.product.name}</td><td>{row.quantityProduced ?? "—"}</td><td>{statusLabel(row.status)}</td><td><Link className="btn secondary" href={`/production/details/${row.id}`}>Ver detalhes</Link></td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
