import { requireOperationalUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { LotDispatchForm } from "@/components/LotDispatchForm";
import { getAvailableFinishedLots, getRecentLotDispatches } from "@/lib/lot-dispatch";

export default async function LotDispatchPage() {
  const user = await requireOperationalUser();
  const [lots, recent] = await Promise.all([
    getAvailableFinishedLots(),
    getRecentLotDispatches(30),
  ]);

  return <>
    <PageIntro
      title="Saída de Lotes"
      subtitle="Registe os lotes de produto acabado expedidos para clientes e mantenha o stock de lotes atualizado."
    />

    <div className="notice">
      Uma produção finalizada entra automaticamente no stock de produto acabado. Ao registar uma saída para cliente, a quantidade expedida é abatida ao lote ou lotes selecionados.
    </div>

    <LotDispatchForm lots={lots} employeeName={user.name}/>

    <section className="panel lot-dispatch-history">
      <div className="section-heading">
        <div><h2>Saídas registadas recentemente</h2><p className="muted small">Cliente, encomenda, fatura, artigo, lotes utilizados e funcionário responsável.</p></div>
      </div>

      {recent.length === 0
        ? <p className="empty-state">Ainda não existem saídas de lotes registadas.</p>
        : <div className="responsive-table"><table>
          <thead><tr><th>Data</th><th>Cliente</th><th>Encomenda</th><th>Fatura</th><th>Artigo</th><th>Quantidade</th><th>Lotes</th><th>Funcionário</th></tr></thead>
          <tbody>{recent.map((row) => <tr key={row.id}>
            <td>{new Date(`${row.dispatchDate}T12:00:00`).toLocaleDateString("pt-PT")}</td>
            <td><strong>{row.customerName}</strong></td>
            <td>{row.orderReference}</td>
            <td>{row.invoiceNumber}</td>
            <td>{row.productCode} — {row.productName}</td>
            <td>{row.orderedQuantityUnits.toLocaleString("pt-PT")} artigos</td>
            <td>{row.lots || "—"}</td>
            <td>{row.createdByName}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </>;
}
