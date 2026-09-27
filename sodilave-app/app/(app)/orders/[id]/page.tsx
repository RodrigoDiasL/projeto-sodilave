import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCommerceReadAccess } from "@/lib/auth";
import { getSalesOrders, getOrderDispatches } from "@/lib/sales-orders";
import { formatEuro } from "@/lib/order-values";
import { PageIntro } from "@/components/PageIntro";
import { FeedbackForm } from "@/components/FeedbackForm";
import { cancelSalesOrder } from "@/app/actions/sales-orders";
const labels={PENDING:"Por entregar",PARTIAL:"Entrega parcial",COMPLETED:"Entregue",CANCELLED:"Anulada"};
export default async function OrderPage({params}:{params:Promise<{id:string}>}) {
  const user=await requireCommerceReadAccess();const id=Number((await params).id);
  if(!Number.isSafeInteger(id)||id<=0)notFound();
  const [order]=(await getSalesOrders({id}));if(!order)notFound();
  const dispatches=await getOrderDispatches(id);const canCancel=["ADMIN","PRODUCTION_MANAGER","LOGISTICS"].includes(user.role)&&order.status==="PENDING";
  return <><PageIntro title={order.reference} subtitle={`${order.customerName} · ${labels[order.status]}`} back="/orders"/>
    <section className="panel form-stack"><div className="detail-grid"><p><strong>Cliente:</strong> {order.customerName}</p><p><strong>Data:</strong> {order.orderDate.split("-").reverse().join("/")}</p><p><strong>Referência do cliente:</strong> {order.customerReference||"—"}</p><p><strong>Registada por:</strong> {order.createdByName}</p></div>
      {order.notes&&<p className="order-notes">{order.notes}</p>}{order.cancelReason&&<p className="alert error">Encomenda anulada: {order.cancelReason}</p>}
      <p className="order-total">Total sem IVA: <strong>{formatEuro(order.totalCents)}</strong></p>
      <p className="muted">Encomenda → artigo → saídas → lotes e faturas. Os preços ficam guardados com a encomenda.</p>
      {order.items.map(item=><article className="order-item-history subpanel" key={item.id}><h2>{item.productCode} — {item.productName}</h2><p>Encomendado: <strong>{item.quantityUnits.toLocaleString("pt-PT")} un.</strong> · Entregue: <strong>{item.deliveredUnits.toLocaleString("pt-PT")} un.</strong> · Em falta: <strong>{item.remainingUnits.toLocaleString("pt-PT")} un.</strong></p><p>Preço unitário: {Number(item.unitPrice).toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:4})} € · Subtotal: {formatEuro(item.totalCents)} sem IVA</p>
        {order.status!=="CANCELLED"&&item.remainingUnits>0&&user.role!=="AUDITOR"&&<Link className="btn primary" href={`/lot-dispatch?order=${order.id}&item=${item.id}`}>Registar saída deste artigo</Link>}
        {dispatches.filter(d=>Number(d.salesOrderItemId)===item.id).map(d=><div className="order-dispatch-history" key={d.id}><strong>Saída #{d.id} · {d.dispatchDate} · {d.orderedQuantityUnits} un. {d.cancelledAt?"— ANULADA":""}</strong><p>Fatura: {d.invoiceNumber} · Registada por {d.createdByName}</p><p>Lotes: {d.lots??"—"}</p>{d.cancelReason&&<p>Motivo: {d.cancelReason}</p>}</div>)}
      </article>)}
    </section>{canCancel&&<section className="panel"><h2>Anular encomenda</h2><p className="muted">Para corrigir artigos ou preços, anule a encomenda e registe a versão correta. O histórico fica preservado.</p><FeedbackForm action={cancelSalesOrder} successMessage="Encomenda anulada com sucesso." className="form-stack"><input type="hidden" name="id" value={order.id}/><label>Motivo<input name="reason" maxLength={500} required/></label><button className="btn secondary">Anular encomenda</button></FeedbackForm></section>}</>;
}
