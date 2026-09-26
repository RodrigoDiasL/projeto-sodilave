import { db } from "@/lib/db";
import { lineTotalCents, orderReference } from "@/lib/order-values";
export type OrderItem = { id:number; productId:number; productCode:string; productName:string; quantityUnits:number; unitPrice:string; deliveredUnits:number; remainingUnits:number; totalCents:number };
export type SalesOrder = { id:number; reference:string; customerName:string; customerReference:string; orderDate:string; notes:string; status:"PENDING"|"PARTIAL"|"COMPLETED"|"CANCELLED"; cancelReason:string|null; createdByName:string; items:OrderItem[]; totalCents:number };
export async function getSalesOrders(options: { id?:number; pendingOnly?:boolean; limit?:number; offset?:number } = {}): Promise<SalesOrder[]> {
  const limit = Math.max(1,Math.min(500,Math.trunc(options.limit??100)));
  const offset = Math.max(0,Math.min(100000000,Math.trunc(options.offset??0)));
  const conditions = options.id ? "WHERE o.id=?" : options.pendingOnly ? `WHERE o.status='OPEN' AND EXISTS (
    SELECT 1 FROM SalesOrderItem si WHERE si.salesOrderId=o.id AND si.quantityUnits >
    (SELECT COALESCE(SUM(d.orderedQuantityUnits),0) FROM LotDispatch d WHERE d.salesOrderItemId=si.id AND d.cancelledAt IS NULL))` : "";
  const orders=await db.query<any[]>(`SELECT o.*,DATE_FORMAT(o.orderDate,'%Y-%m-%d') AS dateText,u.name AS createdByName
    FROM SalesOrder o INNER JOIN User u ON u.id=o.createdById ${conditions} ORDER BY o.orderDate DESC,o.id DESC LIMIT ${limit} OFFSET ${offset}`, options.id?[options.id]:[]);
  if(!orders.length)return [];
  const items=await db.query<any[]>(`SELECT i.*,COALESCE(SUM(CASE WHEN d.cancelledAt IS NULL THEN d.orderedQuantityUnits ELSE 0 END),0) AS deliveredUnits
    FROM SalesOrderItem i LEFT JOIN LotDispatch d ON d.salesOrderItemId=i.id
    WHERE i.salesOrderId IN (${orders.map(()=>"?").join(",")})
    GROUP BY i.id ORDER BY i.id`,orders.map(o=>o.id));
  return orders.map(o=>{
    const lines:OrderItem[]=items.filter(i=>Number(i.salesOrderId)===Number(o.id)).map(i=>({
      id:Number(i.id), productId:Number(i.productId),productCode:String(i.productCode),productName:String(i.productName),
      quantityUnits:Number(i.quantityUnits),unitPrice:String(i.unitPrice),deliveredUnits:Number(i.deliveredUnits),
      remainingUnits:Math.max(0,Number(i.quantityUnits)-Number(i.deliveredUnits)),totalCents:lineTotalCents(Number(i.quantityUnits),String(i.unitPrice)),
    }));
    const status=o.status==="CANCELLED"?"CANCELLED":lines.every(i=>i.remainingUnits===0)?"COMPLETED":lines.some(i=>i.deliveredUnits>0)?"PARTIAL":"PENDING";
    return {id:Number(o.id),reference:orderReference(Number(o.id)),customerName:String(o.customerName),customerReference:o.customerReference??"",orderDate:o.dateText,notes:o.notes??"",status,cancelReason:o.cancelReason,createdByName:o.createdByName,items:lines,totalCents:lines.reduce((sum,i)=>sum+i.totalCents,0)};
  });
}
export async function getOrderDispatches(orderId:number) {
  // Group in application code so MySQL's GROUP_CONCAT limit cannot truncate lot history.
  const rows=await db.query<any[]>(`SELECT d.id,d.salesOrderItemId,d.invoiceNumber,d.orderedQuantityUnits,d.cancelledAt,d.cancelReason,
    DATE_FORMAT(d.dispatchDate,'%Y-%m-%d') AS dispatchDate,u.name AS createdByName,
    COALESCE(pa.labelCode,p.productionLot) AS lotCode,dl.quantityUnits AS lotQuantity
    FROM LotDispatch d INNER JOIN SalesOrderItem i ON i.id=d.salesOrderItemId
    INNER JOIN User u ON u.id=d.createdById LEFT JOIN LotDispatchLine dl ON dl.lotDispatchId=d.id
    LEFT JOIN Production p ON p.id=dl.productionId LEFT JOIN ProductionLotAssociation pa ON pa.productionId=p.id
    WHERE i.salesOrderId=? ORDER BY d.dispatchDate,d.id,p.id`,[orderId]);
  const grouped=new Map<number,any>();
  for(const {lotCode,lotQuantity,...row} of rows){
    let dispatch=grouped.get(Number(row.id));
    if(!dispatch){dispatch={...row,lots:[] as string[]};grouped.set(Number(row.id),dispatch);}
    if(lotCode)dispatch.lots.push(`${lotCode} · ${lotQuantity} un.`);
  }
  return [...grouped.values()].map(row=>({...row,lots:row.lots.join(" | ")}));
}
