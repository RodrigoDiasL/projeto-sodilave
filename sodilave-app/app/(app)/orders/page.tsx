import Link from "next/link";
import { requireCommerceReadAccess } from "@/lib/auth";
import { getSalesOrders } from "@/lib/sales-orders";
import { formatEuro } from "@/lib/order-values";
import { PageIntro } from "@/components/PageIntro";
const labels={PENDING:"Por entregar",PARTIAL:"Entrega parcial",COMPLETED:"Entregue",CANCELLED:"Anulada"};
export default async function OrdersPage({searchParams}:{searchParams:Promise<{page?:string}>}) {
  const user=await requireCommerceReadAccess();const params=await searchParams;
  const page=Math.max(1,Math.min(1000000,Math.trunc(Number(params.page)||1)));
  const results=await getSalesOrders({limit:101,offset:(page-1)*100});const orders=results.slice(0,100);
  const canCreate=["ADMIN","PRODUCTION_MANAGER","LOGISTICS"].includes(user.role);
  return <><PageIntro title="Encomendas" subtitle="Da encomenda do cliente aos lotes expedidos e respetivas faturas."/>
    <div className="button-row">{canCreate&&<Link className="btn primary" href="/orders/new">Adicionar Encomenda</Link>}{user.role!=="AUDITOR"&&<Link className="btn secondary" href="/lot-dispatch">Dar saída de lotes</Link>}</div>
    <section className="panel"><p className="muted">Página {page}. As entregas parciais mantêm a quantidade em falta disponível para expedição.</p>
      {!orders.length?<p className="empty-state">Ainda não existem encomendas registadas.</p>:<div className="responsive-table"><table><thead><tr><th>Encomenda</th><th>Cliente</th><th>Data</th><th>Artigos / entregas</th><th>Total sem IVA</th><th>Estado</th></tr></thead><tbody>
        {orders.map(order=><tr key={order.id}><td><Link href={`/orders/${order.id}`}><strong>{order.reference}</strong></Link>{order.customerReference&&<small className="order-line-total">{order.customerReference}</small>}</td><td>{order.customerName}</td><td>{order.orderDate.split("-").reverse().join("/")}</td><td>{order.items.map(item=><div key={item.id}>{item.productCode} · {item.deliveredUnits.toLocaleString("pt-PT")} / {item.quantityUnits.toLocaleString("pt-PT")} un.</div>)}</td><td>{formatEuro(order.totalCents)}</td><td>{labels[order.status]}</td></tr>)}
      </tbody></table></div>}
    </section><nav className="button-row" aria-label="Páginas de encomendas">{page>1&&<Link className="btn secondary" href={`/orders?page=${page-1}`}>Anterior</Link>}{results.length>100&&<Link className="btn secondary" href={`/orders?page=${page+1}`}>Seguinte</Link>}</nav></>;
}
