import { ProductUnitFields } from "@/components/ProductUnitFields";
import { FeedbackForm } from "@/components/FeedbackForm";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAuditAccess } from "@/lib/auth";
import { createProduct, deleteProduct, setProductActive } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";

type ProductMachineRow={productId:number;machineId:number;machineCode:string};

export default async function Page(){
  const user=await requireAuditAccess();
  const [rows,machines,links]=await Promise.all([
    db.product.findMany({orderBy:{name:"asc"}}),
    db.machine.findMany({where:{active:true},orderBy:{code:"asc"},select:{id:true,code:true,name:true}}),
    db.$queryRaw<ProductMachineRow[]>`SELECT pm.productId,pm.machineId,m.code AS machineCode FROM ProductMachine pm JOIN Machine m ON m.id=pm.machineId ORDER BY m.code`,
  ]);
  return <AdminPage title="Produtos" subtitle="Consultar e gerir os artigos produzidos e as máquinas autorizadas.">
    {user.role==="ADMIN"&&<section className="subpanel product-create-panel"><h2>Adicionar produto</h2><FeedbackForm action={createProduct} className="product-create-form form-stack">
      <div className="three-col"><label>Código<input name="code" placeholder="Ex.: PROD001" maxLength={40} required/></label><label>Designação<input name="name" placeholder="Ex.: Garrafão 5 L" maxLength={120} required/></label><ProductUnitFields/><label>Família para total de stock<input name="stockFamily" maxLength={80} placeholder="Ex.: Jerrycan 5 L"/></label></div>
      <fieldset><legend>Máquinas que produzem este artigo *</legend><div className="machine-checkbox-grid">{machines.map(m=><label className="check" key={m.id}><input type="checkbox" name="machineIds" value={m.id}/><strong>Máquina {m.code}</strong><span>{m.name}</span></label>)}</div></fieldset>
      <button className="btn primary">Adicionar produto</button>
    </FeedbackForm></section>}
    <div className="product-list">{rows.map(r=>{const assigned=links.filter(l=>l.productId===r.id).map(l=>`M${l.machineCode}`);return <article className="product-list-card" key={r.id}>
      <div><span className={`status-pill ${r.active?'active':'inactive'}`}>{r.active?'Ativo':'Inativo'}</span><h2>{r.name}</h2><p>Código: {r.code}</p><p><strong>Máquinas:</strong> {assigned.length?assigned.join(', '):'Nenhuma definida'}</p></div>
      <div className="product-card-actions"><Link className="btn secondary" href={`/admin/products/${r.id}`}>Ver detalhes</Link>{user.role==="ADMIN"&&<><Link className="btn secondary" href={`/admin/products/${r.id}/edit`}>Editar</Link><Link className="btn secondary" href={`/admin/products/${r.id}/variant`}>Criar variante</Link><FeedbackForm action={setProductActive}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="active" value={r.active?'false':'true'}/><button className="btn secondary">{r.active?'Desativar':'Ativar'}</button></FeedbackForm><FeedbackForm action={deleteProduct}><input type="hidden" name="id" value={r.id}/><ConfirmDeleteButton label="Eliminar" message="Eliminar este produto? Se já tiver histórico, será apenas desativado."/></FeedbackForm></>}</div>
    </article>})}</div>
  </AdminPage>;
}
