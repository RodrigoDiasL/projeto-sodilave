import { randomUUID } from "node:crypto";
import { requireProductionManager } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatLocalDateInput } from "@/lib/shift";
import { PageIntro } from "@/components/PageIntro";
import { SalesOrderForm } from "@/components/SalesOrderForm";
export default async function NewOrderPage() {
  await requireProductionManager();
  const [products,customers]=await Promise.all([
    db.product.findMany({where:{active:true},select:{id:true,code:true,name:true},orderBy:{name:"asc"}}),
    db.query<{customerName:string}[]>("SELECT DISTINCT customerName FROM SalesOrder ORDER BY customerName LIMIT 200"),
  ]);
  return <><PageIntro title="Adicionar Encomenda" subtitle="Registar o cliente, artigos, quantidades e preços acordados." back="/orders"/>
    <SalesOrderForm products={products} customers={customers.map(c=>c.customerName)} requestId={randomUUID()} today={formatLocalDateInput()}/></>;
}
