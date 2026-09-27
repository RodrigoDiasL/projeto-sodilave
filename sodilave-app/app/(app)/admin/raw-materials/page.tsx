import Link from "next/link";
import { FeedbackForm } from "@/components/FeedbackForm";
import { db } from "@/lib/db";
import { requireAuditAccess } from "@/lib/auth";
import { createRawMaterial, deleteRawMaterial, updateRawMaterial } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
export default async function Page(){
  const user=await requireAuditAccess(); const canEdit=user.role==="ADMIN";
  const [rows,counts]=await Promise.all([db.rawMaterial.findMany({orderBy:{name:"asc"}}),db.query<any[]>("SELECT rawMaterialId,COUNT(*) AS lots,SUM(CASE WHEN status='ACTIVE' THEN quantityAvailable ELSE 0 END) AS available FROM RawMaterialLot GROUP BY rawMaterialId")]);
  return <AdminPage title="Matérias-primas" subtitle="Cada matéria-prima tem os seus lotes e quantidades. Pode repetir o código de família, como PEAD, distinguindo as gamas pela designação.">
    {canEdit&&<FeedbackForm action={createRawMaterial} className="panel form-stack"><h2>Adicionar matéria-prima</h2><div className="two-col"><input name="code" placeholder="Código / família (ex.: PEAD)" maxLength={40} required/><input name="name" placeholder="Designação / gama" maxLength={120} required/><input name="materialType" placeholder="Tipo (PEAD, PP, masterbatch...)"/><input name="color" placeholder="Cor"/><input name="internalReference" placeholder="Referência interna (opcional)"/><input value="kg" readOnly aria-label="Unidade"/></div><textarea name="notes" placeholder="Observações técnicas ou restrições de utilização"/><button className="btn primary">Adicionar matéria-prima</button></FeedbackForm>}
    {rows.map(row=>{const stock=counts.find(c=>Number(c.rawMaterialId)===row.id);return <section className="panel form-stack" key={`${row.id}:${row.updatedAt}`}>
      <h2>{row.code} — {row.name}</h2><p>{row.active?"Ativa":"Inativa"} · {Number(stock?.available??0).toLocaleString("pt-PT")} kg disponíveis</p>
      <Link className="btn primary" href={`/admin/raw-materials/${row.id}/lots`}>Lotes ({stock?.lots??0})</Link>
      {canEdit?<><FeedbackForm action={updateRawMaterial} className="form-stack"><input type="hidden" name="id" value={row.id}/><div className="two-col">
        <label>Código / família<input name="code" defaultValue={row.code} required/></label><label>Designação / gama<input name="name" defaultValue={row.name} required/></label><label>Tipo<input name="materialType" defaultValue={row.materialType??""}/></label><label>Cor<input name="color" defaultValue={row.color??""}/></label><label>Referência interna<input name="internalReference" defaultValue={row.internalReference??""}/></label></div><label>Observações<textarea name="notes" defaultValue={row.notes??""}/></label><label className="check"><input name="active" type="checkbox" defaultChecked={row.active}/>Ativa</label><button className="btn secondary">Guardar</button></FeedbackForm>
      <FeedbackForm action={deleteRawMaterial}><input type="hidden" name="id" value={row.id}/><ConfirmDeleteButton label="Eliminar / desativar" message="Eliminar esta matéria-prima? Se tiver lotes, será apenas desativada."/></FeedbackForm></>:<p>Tipo: {row.materialType||"—"} · Cor: {row.color||"—"} · Referência: {row.internalReference||"—"}<br/>{row.notes}</p>}
    </section>})}
  </AdminPage>;
}
