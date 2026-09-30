import Link from "next/link";
import {notFound} from "next/navigation";
import {db} from "@/lib/db";
import {requireUser} from "@/lib/auth";
import {PageIntro} from "@/components/PageIntro";
import {ProductionQualityDetails} from "@/components/ProductionQualityDetails";
import {productionUnitLabel} from "@/lib/production-unit";
const n=(v:unknown)=>v==null?"—":Number(v).toLocaleString("pt-PT",{maximumFractionDigits:3});
export default async function Page({params}:{params:Promise<{id:string}>}){
 const user=await requireUser();const {id}=await params;const base=await db.production.findUnique({where:{id:Number(id)}});if(!base)notFound();
 const start=new Date(base.startedAt);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);
 const rows=await db.production.findMany({where:{shiftCode:base.shiftCode,startedAt:{gte:start,lt:end},status:{not:"CANCELLED"}},include:{machine:true,product:true,operator:true,materials:{include:{rawMaterialLot:{include:{rawMaterial:true}}}},tests:true},orderBy:{machine:{code:"asc"}}});
 const ids=rows.map(r=>r.id);const marks=ids.map(()=>"?").join(",");
 const [cavities,right]=ids.length?await Promise.all([db.query<any[]>(`SELECT * FROM ProductionCavityData WHERE productionId IN (${marks})`,ids),db.query<any[]>(`SELECT * FROM ProductionCavityTest WHERE productionId IN (${marks}) AND cavity='RIGHT'`,ids)]):[[],[]];
 return <><PageIntro title={`Produção do turno ${base.shiftCode}`} subtitle={base.startedAt.toLocaleDateString("pt-PT")}/><div className="machine-forms-stack">{rows.map(r=><section className="panel form-stack" key={r.id}><h2>Máquina {r.machine.code} — {r.product.name}</h2><div className="detail-grid"><p><b>Lote:</b> {r.productionLot}</p><p><b>Operador:</b> {r.operator.name}</p><p><b>Quantidade:</b> {n(r.quantityProduced)} {productionUnitLabel(r.productionUnitSnapshot??r.product.productionUnit,Number(r.quantityProduced))}</p><p><b>Artigos por embalagem:</b> {n(r.unitsPerPackageSnapshot??r.product.unitsPerPackage)}</p></div><ProductionQualityDetails production={r} cavity={cavities.find(c=>c.productionId===r.id)} testsRight={right.filter(t=>t.productionId===r.id)}/><h3>Matérias-primas / masterbatches</h3><div className="responsive-table"><table><thead><tr><th>Matéria-prima</th><th>Lote</th><th>%</th><th>Kg consumidos</th></tr></thead><tbody>{r.materials.map((m:any)=><tr key={m.id}><td>{m.rawMaterialLot.rawMaterial.name}</td><td>{m.rawMaterialLot.supplierLot}</td><td>{n(m.percentage)}</td><td>{n(m.quantityKg)}</td></tr>)}</tbody></table></div><p>{r.observations||"Sem observações."}</p>{user.role!=="AUDITOR"&&r.status==="DRAFT"&&<Link className="btn primary" href={`/production/${r.id}`}>Continuar esta produção</Link>}{user.role==="ADMIN"&&<Link className="btn secondary" href={`/admin/productions/${r.id}/edit`}>Corrigir / eliminar</Link>}</section>)}</div><Link className="btn secondary" href="/production">Voltar às produções</Link></>;
}
