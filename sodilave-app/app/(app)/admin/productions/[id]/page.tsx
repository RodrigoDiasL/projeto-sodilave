import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuditAccess } from "@/lib/auth";
import { AdminPage } from "@/components/AdminPage";

const statusLabel=(s:string)=>({DRAFT:"Em aberto",FINALIZED:"Finalizada",CANCELLED:"Cancelada"}[s]||s);
const tr=(s:string)=>({CONFORMING:"Conforme",NON_CONFORMING:"Não conforme",NOT_PERFORMED:"Não realizado",NOT_APPLICABLE:"Não aplicável"}[s]||s);
const n=(v:unknown)=>v==null?"—":new Intl.NumberFormat("pt-PT",{maximumFractionDigits:3}).format(Number(v));
type CavityDataRow={productionId:number;rightInitialWeightG:unknown;rightMidWeightG:unknown};
type CavityTestRow={productionId:number;type:string;moment:string;result:string};

export default async function Page({params}:{params:Promise<{id:string}>}){
  const user=await requireAuditAccess();
  const {id}=await params;
  const base=await db.production.findUnique({where:{id:Number(id)}});
  if(!base)notFound();
  const dayStart=new Date(base.startedAt);dayStart.setHours(0,0,0,0);
  const dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1);
  const rows=await db.production.findMany({where:{shiftCode:base.shiftCode,startedAt:{gte:dayStart,lt:dayEnd},status:{not:"CANCELLED"}},include:{machine:true,product:true,operator:true,materials:{include:{rawMaterialLot:{include:{rawMaterial:true}}}},tests:true},orderBy:{machine:{code:"asc"}}});
  const machine7Ids=rows.filter(row=>row.machine.code==="7").map(row=>row.id);
  const cavityDataRows:CavityDataRow[]=machine7Ids.length?await db.$queryRawUnsafe(`SELECT productionId, rightInitialWeightG, rightMidWeightG FROM ProductionCavityData WHERE productionId IN (${machine7Ids.join(",")})`):[];
  const cavityTestRows:CavityTestRow[]=machine7Ids.length?await db.$queryRawUnsafe(`SELECT productionId, type, moment, result FROM ProductionCavityTest WHERE cavity='RIGHT' AND productionId IN (${machine7Ids.join(",")})`):[];
  const cavityDataMap=new Map(cavityDataRows.map(row=>[row.productionId,row]));
  const cavityTestsMap=new Map<number,CavityTestRow[]>();
  for(const test of cavityTestRows)cavityTestsMap.set(test.productionId,[...(cavityTestsMap.get(test.productionId)||[]),test]);

  return <AdminPage title={`Produção do turno ${base.shiftCode}`} subtitle={`${base.startedAt.toLocaleDateString("pt-PT")} — detalhe de todas as máquinas registadas.`}>
    <div className="machine-forms-stack">{rows.map(r=>{
      const cavity=cavityDataMap.get(r.id);
      const rightTests=cavityTestsMap.get(r.id)||[];
      const leftTests=r.tests.map(t=>`${t.type==="LEAK"?"Vedação":"Queda"} ${t.moment==="START"?"início":"meio"}: ${tr(t.result)}`).join(" · ")||"—";
      const rightTestsText=rightTests.map(t=>`${t.type==="LEAK"?"Vedação":"Queda"} ${t.moment==="START"?"início":"meio"}: ${tr(t.result)}`).join(" · ")||"—";
      return <section className="panel form-stack" key={r.id}>
        <h2>Máquina {r.machine.code} — {r.product.name}</h2>
        <div className="detail-grid"><p><b>Lote produzido:</b> {r.productionLot}</p><p><b>Operador:</b> {r.operator.name}</p><p><b>Estado:</b> {statusLabel(r.status)}</p><p><b>Embalagens produzidas:</b> {r.quantityProduced??"—"}</p><p><b>Unidades por embalagem:</b> {r.product.unitsPerPackage??"—"}</p><p><b>Total de unidades:</b> {r.quantityProduced&&r.product.unitsPerPackage?r.quantityProduced*r.product.unitsPerPackage:"—"}</p></div>
        {r.machine.code==="7"?<div className="two-col"><section className="subpanel"><h3>Embalagem da cavidade esquerda</h3><p><b>Peso inicial:</b> {n(r.initialWeightG)} g</p><p><b>Peso intermédio:</b> {n(r.midWeightG)} g</p><p><b>Testes:</b> {leftTests}</p></section><section className="subpanel"><h3>Embalagem da cavidade direita</h3><p><b>Peso inicial:</b> {n(cavity?.rightInitialWeightG)} g</p><p><b>Peso intermédio:</b> {n(cavity?.rightMidWeightG)} g</p><p><b>Testes:</b> {rightTestsText}</p></section></div>:<><div className="detail-grid"><p><b>Peso inicial:</b> {n(r.initialWeightG)} g</p><p><b>Peso intermédio:</b> {n(r.midWeightG)} g</p></div><h3>Testes</h3><p>{leftTests}</p></>}
        <h3>Matérias-primas</h3><div className="responsive-table"><table><thead><tr><th>Matéria-prima</th><th>Lote</th><th>%</th><th>Quantidade real</th></tr></thead><tbody>{r.materials.map(m=><tr key={m.id}><td>{m.rawMaterialLot.rawMaterial.name}</td><td>{m.rawMaterialLot.supplierLot}</td><td>{n(m.percentage)}%</td><td>{n(m.quantityKg)} kg</td></tr>)}</tbody></table></div>
        <h3>Observações</h3><p>{r.observations||"Sem observações."}</p>{user.role==="ADMIN"&&r.status!=="CANCELLED"&&<Link className="btn primary" href={`/production/${r.id}`}>{r.status==="DRAFT"?"Continuar e finalizar":"Corrigir produção"}</Link>}
      </section>})}</div>
    <div className="button-row"><Link className="btn secondary" href="/admin/productions">Voltar às produções</Link></div>
  </AdminPage>;
}
