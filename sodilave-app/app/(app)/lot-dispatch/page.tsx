import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getSalesOrders } from "@/lib/sales-orders";
import { requireOperationalUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { CancelLotDispatchForm } from "@/components/CancelLotDispatchForm";
import { LotDispatchForm } from "@/components/LotDispatchForm";
import { getAvailableFinishedLots, getRecentLotDispatches } from "@/lib/lot-dispatch";

export default async function LotDispatchPage({searchParams}:{searchParams:Promise<{order?:string;item?:string}>}) {
  const selection=await searchParams;
  const user = await requireOperationalUser();
  const [lots, recent, orders] = await Promise.all([
    getAvailableFinishedLots(),
    getRecentLotDispatches(30),
    getSalesOrders({pendingOnly:true,limit:500}),
  ]);

  const requestedOrder=Number(selection.order);
  if(Number.isSafeInteger(requestedOrder)&&requestedOrder>0&&!orders.some(order=>order.id===requestedOrder)){
    const [selected]=await getSalesOrders({id:requestedOrder});
    if(selected&&(selected.status==="PENDING"||selected.status==="PARTIAL"))orders.unshift(selected);
  }

  return <>
    <PageIntro
      title="Saída de Lotes"
      subtitle="Registe os lotes de produto acabado expedidos para clientes e mantenha o stock de lotes atualizado."
    />

    <div className="notice">
      Uma produção finalizada e localizada entra no stock de produto acabado. Ao registar uma saída, indique as posições físicas de onde o produto foi retirado; a aplicação abate automaticamente essas estibas/paletes.
    </div>

    <div className="button-row"><Link className="btn secondary" href="/orders">Consultar encomendas</Link>{["ADMIN","PRODUCTION_MANAGER"].includes(user.role)&&<Link className="btn primary" href="/orders/new">Adicionar Encomenda</Link>}</div>
    <LotDispatchForm lots={lots} employeeName={user.name} orders={orders} requestId={randomUUID()} initialOrderId={selection.order} initialItemId={selection.item}/>

    <section className="panel lot-dispatch-history">
      <div className="section-heading">
        <div><h2>Saídas registadas recentemente</h2><p className="muted small">Cliente, encomenda, fatura, artigo, lotes utilizados e funcionário responsável.</p></div>
      </div>

      {recent.length === 0
        ? <p className="empty-state">Ainda não existem saídas de lotes registadas.</p>
        : <div className="responsive-table"><table>
          <thead><tr><th>Saída</th><th>Data</th><th>Cliente</th><th>Encomenda</th><th>Fatura</th><th>Artigo</th><th>Quantidade</th><th>Lotes</th><th>Funcionário</th><th>Estado / correção</th></tr></thead>
          <tbody>{recent.map((row) => <tr key={row.id}>
            <td><strong>#{row.id}</strong></td>
            <td>{new Date(`${row.dispatchDate}T12:00:00`).toLocaleDateString("pt-PT")}</td>
            <td><strong>{row.customerName}</strong></td>
            <td>{row.salesOrderId?<Link href={`/orders/${row.salesOrderId}`}>{row.orderReference}</Link>:row.orderReference}</td>
            <td>{row.invoiceNumber}</td>
            <td>{row.productCode} — {row.productName}</td>
            <td>{row.orderedQuantityUnits.toLocaleString("pt-PT")} artigos</td>
            <td>{row.lots || "—"}</td>
            <td>{row.createdByName}</td>
            <td>{row.cancelledAt ? <>Anulada — {row.cancelReason}</> : user.role === "ADMIN" ? <CancelLotDispatchForm dispatchId={row.id}/> : "Registada"}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </>;
}
