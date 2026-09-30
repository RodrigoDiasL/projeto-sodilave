import {productionUnitLabel} from "@/lib/production-unit";
import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/auth";
import {db} from "@/lib/db";
import {formatLocalDateInput} from "@/lib/shift";
import {AdminPage} from "@/components/AdminPage";
import {FeedbackForm} from "@/components/FeedbackForm";
import {ConfirmDeleteButton} from "@/components/ConfirmDeleteButton";
import {correctProductionRecord,deleteProductionRecord} from "@/app/actions/production-admin";
export default async function Page({params}:{params:Promise<{id:string}>}){
  await requireAdmin();const {id}=await params;
  const row=await db.production.findUnique({where:{id:Number(id)},include:{machine:true,product:true,tests:true}});
  if(!row)notFound();
  if(row.status==="CANCELLED")return <AdminPage title="Produção eliminada" subtitle="Este registo foi retirado dos contadores e do stock ativo."><Link className="btn secondary" href="/admin/productions">Voltar às produções</Link></AdminPage>;
  const [products,users,balances]=await Promise.all([
    db.product.findMany({orderBy:{name:"asc"}}),db.user.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),
    db.query<any[]>("SELECT b.locationId,b.quantityPackages,l.warehouseName,l.code FROM ProductionStorageBalance b JOIN StorageLocation l ON l.id=b.locationId WHERE b.productionId=? ORDER BY b.locationId",[row.id]),
  ]);
  const version=new Date(row.updatedAt).toISOString();
  return <AdminPage title={`Editar produção · ${row.product.name}`} subtitle={`Máquina ${row.machine.code} · Lote ${row.productionLot}`}>
    <FeedbackForm key={version+JSON.stringify(balances)} action={correctProductionRecord} className="panel form-stack">
      <input type="hidden" name="id" value={row.id}/><input type="hidden" name="expectedUpdatedAt" value={version}/><input type="hidden" name="expectedBalances" value={JSON.stringify(balances.map(b=>[Number(b.locationId),Number(b.quantityPackages)]))}/>
      <h2>Corrigir registo</h2><div className="two-col">
      {row.recordOrigin!=="INITIAL_STOCK"&&<><label>Data de produção<input type="date" name="date" defaultValue={formatLocalDateInput(row.startedAt)} required/></label><label>Turno<select name="shiftCode" defaultValue={row.shiftCode}><option value="A">A · 00:00–08:00</option><option value="B">B · 08:00–16:00</option><option value="C">C · 16:00–24:00</option></select></label></>}
      <label>Artigo / variante<select name="productId" defaultValue={row.productId}>{products.map(p=><option key={p.id} value={p.id}>{p.code} — {p.name}{!p.active?" (inativo)":""}</option>)}</select></label>
      <label>Operador<select name="operatorId" defaultValue={row.operatorId}>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label>Quantidade produzida ({productionUnitLabel(row.productionUnitSnapshot)})<input name="quantityProduced" type="number" min="0" max="10000000" step="1" defaultValue={row.quantityProduced??""} required={row.status==="FINALIZED"}/></label>
      </div>
      <p className="notice">Corrigir a data e o turno conserva o código de lote que já foi usado nos sacos. Os contadores passam a usar a data corrigida. O consumo de matérias-primas permanece registado como foi medido.</p>
      {row.recordOrigin==="HISTORICAL_IMPORT"&&<p className="notice">Histórico importado: esta correção não cria stock físico. A folha original permanece disponível para consulta.</p>}
      {balances.length>0&&<section className="subpanel form-stack"><h3>Quantidades atuais no armazém</h3><p>Se reduzir a quantidade produzida, corrija também as posições afetadas. As quantidades já expedidas não podem ser retiradas.</p>{balances.map(b=><label key={b.locationId}>{b.warehouseName} · {b.code}<input name={`balance_${b.locationId}`} type="number" min="0" max="10000000" step="1" defaultValue={b.quantityPackages} required/></label>)}</section>}
      {row.recordOrigin!=="INITIAL_STOCK"&&<label className="check"><input name="allowAdditional" type="checkbox"/>Se já existir outra produção deste artigo, máquina e turno, confirmo que este é um registo adicional legítimo.</label>}
      <label>Observações<textarea name="observations" maxLength={500} defaultValue={row.observations??""}/></label>
      <label>Motivo da correção<textarea name="reason" maxLength={500} placeholder="Ex.: registo às 16:05 que pertence ao turno B" required/></label>
      <button className="btn primary">Guardar correção administrativa</button>
      {row.recordOrigin==="PRODUCTION"&&<Link className="btn secondary" href={`/production/${row.id}`}>Editar dados de fabrico e matérias-primas / finalizar rascunho</Link>}
    </FeedbackForm>
    <FeedbackForm action={deleteProductionRecord} className="panel form-stack"><h2>Eliminar produção</h2><p>Retira o registo dos contadores e do stock. O consumo de MPs é devolvido. Fica uma marca de eliminação para auditoria. Se já houver saídas para clientes, é necessário corrigi-las primeiro.</p><input type="hidden" name="id" value={row.id}/><input type="hidden" name="expectedUpdatedAt" value={version}/><label>Motivo da eliminação<input name="reason" maxLength={500} required/></label><ConfirmDeleteButton label="Eliminar produção" message="Eliminar esta produção e retirar o seu stock? O registo fica conservado para auditoria."/></FeedbackForm>
    <Link className="btn secondary" href="/admin/productions">Voltar às produções</Link>
  </AdminPage>;
}
