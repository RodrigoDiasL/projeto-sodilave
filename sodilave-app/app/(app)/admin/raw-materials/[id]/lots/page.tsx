import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedbackForm } from "@/components/FeedbackForm";
import { db } from "@/lib/db";
import { requireAuditAccess } from "@/lib/auth";
import { createRawMaterialLot, deleteRawMaterialLot, updateRawMaterialLot } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
const statusLabel=(s:string)=>({ACTIVE:"Ativo",DEPLETED:"Esgotado",CLOSED:"Fechado",CANCELLED:"Cancelado"}[s]||s);
export default async function Page({params}:{params:Promise<{id:string}>}){
  const user=await requireAuditAccess();const id=Number((await params).id);if(!Number.isSafeInteger(id)||id<1)notFound();
  const material=await db.rawMaterial.findUnique({where:{id}});if(!material)notFound();
  const rows=await db.rawMaterialLot.findMany({where:{rawMaterialId:id},orderBy:{receivedAt:"desc"}});const canEdit=user.role==="ADMIN";
  return <AdminPage title={`Lotes — ${material.code} · ${material.name}`} subtitle="Entradas e quantidades desta matéria-prima. Os lotes mantêm a ligação à gama original.">
    <Link className="btn secondary" href="/admin/raw-materials">Voltar às matérias-primas</Link>
    {canEdit&&material.active&&<FeedbackForm action={createRawMaterialLot} className="inline-form"><input type="hidden" name="rawMaterialId" value={id}/><input name="supplierLot" placeholder="Lote do fornecedor" maxLength={80} required/><input name="supplier" placeholder="Fornecedor" maxLength={120}/><input name="quantityInitial" type="number" min="0.001" max="999999999" step="0.001" placeholder="Quantidade (kg)" required/><button className="btn primary">Dar entrada de lote</button></FeedbackForm>}
    {!rows.length&&<p>Ainda não existem lotes desta matéria-prima.</p>}
    {rows.map(row=><section className="panel form-stack" key={`${row.id}:${row.updatedAt}:${row.quantityAvailable}`}>
      <h2>{row.supplierLot}</h2><p>{statusLabel(row.status)} · recebido em {row.receivedAt.toLocaleDateString("pt-PT")} · disponível: {Number(row.quantityAvailable).toLocaleString("pt-PT")} kg</p>
      {canEdit?<><FeedbackForm action={updateRawMaterialLot} className="form-stack"><input type="hidden" name="id" value={row.id}/><input type="hidden" name="rawMaterialId" value={id}/><input type="hidden" name="expectedQuantityAvailable" value={String(Number(row.quantityAvailable))}/>
        <div className="two-col"><label>Lote do fornecedor<input name="supplierLot" defaultValue={row.supplierLot} required/></label><label>Fornecedor<input name="supplier" defaultValue={row.supplier??""}/></label><label>Quantidade inicial (kg)<input name="quantityInitial" type="number" min="0.001" step="0.001" defaultValue={Number(row.quantityInitial)} required/></label><label>Quantidade disponível (kg)<input name="quantityAvailable" type="number" min="0" step="0.001" defaultValue={Number(row.quantityAvailable)} required/></label><label>Estado<select name="status" defaultValue={row.status}><option value="ACTIVE">Ativo</option><option value="DEPLETED">Esgotado</option><option value="CLOSED">Fechado</option><option value="CANCELLED">Cancelado</option></select></label></div><button className="btn secondary">Guardar alterações</button></FeedbackForm>
      <FeedbackForm action={deleteRawMaterialLot}><input type="hidden" name="id" value={row.id}/><ConfirmDeleteButton label="Eliminar / cancelar" message="Eliminar este lote? Se já tiver sido usado, será marcado como cancelado."/></FeedbackForm></>:<p>Quantidade inicial: {Number(row.quantityInitial).toLocaleString("pt-PT")} kg · Fornecedor: {row.supplier||"—"}</p>}
    </section>)}
  </AdminPage>;
}
