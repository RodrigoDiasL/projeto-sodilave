import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { AdminPage } from "@/components/AdminPage";
import { StorageAdmin } from "@/components/StorageAdmin";
export default async function Page(){
  await requireAdmin();
  const [locations,products,machines]=await Promise.all([
    db.storageLocation.findMany({orderBy:[{warehouseCode:"asc"},{zoneType:"asc"},{rowNumber:"asc"},{columnNumber:"asc"}]}),
    db.product.findMany({where:{active:true},orderBy:{name:"asc"}}),
    db.machine.findMany({where:{active:true},orderBy:{code:"asc"}}),
  ]);
  return <AdminPage title="Armazém e stock inicial" subtitle="Gerir posições de estibas e paletes e registar os lotes que já existiam antes da aplicação."><Link href="/stock-map" className="btn secondary">Voltar ao Mapa de Stock</Link><StorageAdmin locations={locations.map(l=>({...l,createdAt:undefined}))} products={products.map(p=>({id:p.id,name:p.name,code:p.code,productionUnit:p.productionUnit,unitsPerPackage:p.unitsPerPackage}))} machines={machines.map(m=>({id:m.id,code:m.code,name:m.name}))}/></AdminPage>;
}
