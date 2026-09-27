"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireCommerceUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { lineTotalCents, parseUnitPrice, validOrderDate, orderReference } from "@/lib/order-values";

export async function createSalesOrder(fd:FormData) {
  const user=await requireCommerceUser();
  const customerName=String(fd.get("customerName")??"").trim();
  const customerReference=String(fd.get("customerReference")??"").trim();
  const orderDate=String(fd.get("orderDate")??"");
  const notes=String(fd.get("notes")??"").trim();
  const requestId=String(fd.get("requestId")??"");
  if(!customerName || customerName.length>191 || customerReference.length>191 || notes.length>1500 || !validOrderDate(orderDate) || !/^[a-f0-9-]{36}$/.test(requestId))throw new Error("Verifique o cliente, a data e a referência da encomenda.");
  let raw:unknown;
  try{raw=JSON.parse(String(fd.get("items")??""));}catch{throw new Error("Os artigos da encomenda são inválidos.");}
  if(!Array.isArray(raw)||!raw.length||raw.length>50)throw new Error("Adicione entre 1 e 50 artigos.");
  const items=raw.map(item=>{
    if(!item||typeof item!=="object")throw new Error("Artigo inválido.");
    const productId=Number(item.productId), quantityUnits=Number(item.quantityUnits),unitPrice=parseUnitPrice(item.unitPrice);
    if(!Number.isSafeInteger(productId)||productId<=0)throw new Error("Selecione um artigo válido.");
    const totalCents=lineTotalCents(quantityUnits,unitPrice);
    return {productId,quantityUnits,unitPrice,totalCents};
  }).sort((a,b)=>a.productId-b.productId);
  if(new Set(items.map(i=>i.productId)).size!==items.length)throw new Error("Cada artigo deve aparecer uma vez. Junte as quantidades na mesma linha.");
  if(items.reduce((sum,i)=>sum+i.totalCents,0)>99999999999)throw new Error("O total da encomenda excede o limite permitido.");
  const requestHash=createHash("sha256").update(JSON.stringify({customerName,customerReference,orderDate,notes,items})).digest("hex");
  const result=await db.$transaction(async tx=>{
    // Serializes duplicate submissions for this account, without global order locks.
    await tx.query("SELECT id FROM User WHERE id=? FOR UPDATE",[user.id]);
    const existing=await tx.query<any[]>("SELECT id,requestHash,createdById FROM SalesOrder WHERE requestId=?",[requestId]);
    if(existing.length){if(existing[0].requestHash!==requestHash||Number(existing[0].createdById)!==user.id)throw new Error("Este pedido já foi utilizado com outros dados. Atualize a página.");return {id:Number(existing[0].id)};}
    const products=await tx.query<any[]>(`SELECT id,code,name FROM Product WHERE active=1 AND id IN (${items.map(()=>"?").join(",")}) ORDER BY id LOCK IN SHARE MODE`,items.map(i=>i.productId));
    if(products.length!==items.length)throw new Error("Um dos artigos já não está ativo.");
    await tx.execute(`INSERT INTO SalesOrder (customerName,customerReference,orderDate,notes,requestId,requestHash,createdById) VALUES (?,?,?,?,?,?,?)`,[customerName,customerReference||null,orderDate,notes||null,requestId,requestHash,user.id]);
    const [order]=await tx.query<{id:number}[]>("SELECT id FROM SalesOrder WHERE requestId=?",[requestId]);
    for(const item of items){const product=products.find(p=>Number(p.id)===item.productId)!;await tx.execute(`INSERT INTO SalesOrderItem (salesOrderId,productId,productCode,productName,quantityUnits,unitPrice) VALUES (?,?,?,?,?,?)`,[order.id,item.productId,product.code,product.name,item.quantityUnits,item.unitPrice]);}
    await tx.auditLog.create({data:{userId:user.id,action:"CREATE",entity:"SalesOrder",entityId:String(order.id),details:{customerName,customerReference,orderDate,items}}});
    return {id:Number(order.id)};
  });
  for(const path of ["/orders","/lot-dispatch","/dashboard"])revalidatePath(path);
  return {...result,reference:orderReference(result.id)};
}

export async function cancelSalesOrder(fd:FormData) {
  const user=await requireCommerceUser();
  const id=Number(fd.get("id")),reason=String(fd.get("reason")??"").trim();
  if(!Number.isSafeInteger(id)||id<=0||!reason||reason.length>500)throw new Error("Indique a encomenda e o motivo de anulação.");
  await db.$transaction(async tx=>{
    const [order]=await tx.query<any[]>("SELECT id,status FROM SalesOrder WHERE id=? FOR UPDATE",[id]);
    if(!order||order.status!=="OPEN")throw new Error("A encomenda não existe ou já foi anulada.");
    const dispatches=await tx.query<any[]>(`SELECT d.id FROM LotDispatch d INNER JOIN SalesOrderItem i ON i.id=d.salesOrderItemId
      WHERE i.salesOrderId=? AND d.cancelledAt IS NULL FOR UPDATE`,[id]);
    if(dispatches.length)throw new Error("Esta encomenda tem saídas registadas. Anule-as antes de anular a encomenda.");
    await tx.execute("UPDATE SalesOrder SET status='CANCELLED',cancelledAt=NOW(3),cancelReason=? WHERE id=?",[reason,id]);
    await tx.auditLog.create({data:{userId:user.id,action:"CANCEL",entity:"SalesOrder",entityId:String(id),details:{reason}}});
  });
  for(const path of ["/orders",`/orders/${id}`,"/lot-dispatch"])revalidatePath(path);
}
