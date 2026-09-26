"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSalesOrder } from "@/app/actions/sales-orders";
import { useFeedback, useFeedbackState } from "@/components/FeedbackProvider";
import { lineTotalCents, parseUnitPrice, formatEuro } from "@/lib/order-values";
type Product={id:number;code:string;name:string};
type Line={key:number;productId:string;quantityUnits:string;unitPrice:string};
export function SalesOrderForm({products,requestId,today,customers}:{products:Product[];requestId:string;today:string;customers:string[]}) {
  const router=useRouter(),notify=useFeedback();const inFlight=useRef(false),nextKey=useRef(1);
  const [lines,setLines]=useState<Line[]>([{key:0,productId:"",quantityUnits:"",unitPrice:""}]);
  const [busy,setBusy]=useState(false),[error,setError]=useFeedbackState("error");
  const change=(key:number,field:keyof Omit<Line,"key">,value:string)=>setLines(rows=>rows.map(row=>row.key===key?{...row,[field]:value}:row));
  const totals=lines.map(line=>{try{return lineTotalCents(Number(line.quantityUnits),parseUnitPrice(line.unitPrice));}catch{return null;}});
  const total=totals.every(value=>value!==null)?totals.reduce<number>((sum,value)=>sum+(value??0),0):null;
  return <form className="panel form-stack" aria-busy={busy} onSubmit={async event=>{
    event.preventDefault();if(inFlight.current)return;const fd=new FormData(event.currentTarget);
    fd.set("items",JSON.stringify(lines.map(({productId,quantityUnits,unitPrice})=>({productId,quantityUnits,unitPrice}))));
    inFlight.current=true;setBusy(true);setError("");
    try{const order=await createSalesOrder(fd);notify("success",`Encomenda ${order.reference} registada com sucesso.`);router.push(`/orders/${order.id}`);router.refresh();}
    catch(e){setError(e instanceof Error?e.message:"Não foi possível registar a encomenda.");}
    finally{inFlight.current=false;setBusy(false);}
  }}><input type="hidden" name="requestId" value={requestId}/>
    <fieldset disabled={busy} className="form-stack">
      <div className="two-col"><label>Cliente *<input name="customerName" list="order-customers" maxLength={191} required placeholder="Nome do cliente"/></label><datalist id="order-customers">{customers.map(name=><option key={name} value={name}/>)}</datalist>
        <label>Data da encomenda *<input name="orderDate" type="date" defaultValue={today} min="2000-01-01" max="2099-12-31" required/></label>
        <label>Referência do cliente<input name="customerReference" maxLength={191} placeholder="Opcional: número da encomenda do cliente"/></label></div>
      <section className="form-stack"><h2>Artigos da encomenda</h2><p className="muted">Quantidades em artigos individuais. Preço unitário em euros, sem IVA, até 4 casas decimais.</p>
        {lines.map((line,index)=><div className="order-line-editor" key={line.key}>
          <label>Artigo *<select value={line.productId} required onChange={e=>change(line.key,"productId",e.target.value)}><option value="">Selecione</option>{products.map(product=><option key={product.id} value={product.id} disabled={lines.some(other=>other.key!==line.key&&Number(other.productId)===product.id)}>{product.code} — {product.name}</option>)}</select></label>
          <label>Quantidade *<input type="number" min="1" max="10000000" step="1" required value={line.quantityUnits} onChange={e=>change(line.key,"quantityUnits",e.target.value)}/></label>
          <label>Preço por artigo (€) *<input inputMode="decimal" pattern="[0-9]{1,8}([.,][0-9]{1,4})?" required placeholder="Ex.: 0,4250" value={line.unitPrice} onChange={e=>change(line.key,"unitPrice",e.target.value)}/></label>
          <div><small>Subtotal sem IVA</small><strong className="order-line-total">{totals[index]===null?"—":formatEuro(totals[index]!)}</strong></div>
          <button type="button" className="btn secondary" disabled={lines.length===1} onClick={()=>setLines(rows=>rows.filter(row=>row.key!==line.key))} aria-label={`Remover artigo ${index+1}`}>Remover</button>
        </div>)}
        <button type="button" className="btn secondary" disabled={lines.length>=50} onClick={()=>setLines(rows=>[...rows,{key:nextKey.current++,productId:"",quantityUnits:"",unitPrice:""}])}>+ Adicionar artigo</button>
      </section>
      <p className="order-total">Total sem IVA: <strong>{total===null?"Preencha os artigos":formatEuro(total)}</strong></p>
      <label>Observações / instruções de entrega<textarea name="notes" maxLength={1500} placeholder="Morada de entrega, condições acordadas ou informação adicional da encomenda"/></label>
      <p className="muted">O número interno da encomenda é atribuído automaticamente. Este registo não emite uma fatura fiscal.</p>
      {error&&<p className="alert error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy||!products.length}>{busy?"A registar…":"Registar encomenda"}</button>
    </fieldset>
  </form>;
}
