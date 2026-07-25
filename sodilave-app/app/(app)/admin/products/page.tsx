import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { createProduct, deleteProduct, setProductActive } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";

export default async function Page(){
  await requireAdmin();
  const rows=await db.product.findMany({orderBy:{name:"asc"}});
  return <AdminPage title="Produtos" subtitle="Consultar e gerir os artigos produzidos.">
    <section className="subpanel product-create-panel"><h2>Adicionar produto</h2><form action={createProduct} className="product-create-form">
      <label>Código<input name="code" placeholder="Ex.: PROD001" maxLength={40} required/></label>
      <label>Designação<input name="name" placeholder="Ex.: Garrafão 5 L" maxLength={120} required/></label>
      <label>Unidades por embalagem<input className="no-spinner" name="unitsPerPackage" type="number" min="1" step="1" placeholder="Ex.: 25" required/></label>
      <button className="btn primary">Adicionar produto</button>
    </form></section>
    <div className="product-list">{rows.map(r=><article className="product-list-card" key={r.id}>
      <div><span className={`status-pill ${r.active?'active':'inactive'}`}>{r.active?'Ativo':'Inativo'}</span><h2>{r.name}</h2><p>Código: {r.code}</p></div>
      <div className="product-card-actions"><Link className="btn secondary" href={`/admin/products/${r.id}`}>Ver detalhes</Link><Link className="btn secondary" href={`/admin/products/${r.id}/edit`}>Editar</Link><form action={setProductActive}><input type="hidden" name="id" value={r.id}/><input type="hidden" name="active" value={r.active?'false':'true'}/><button className="btn secondary">{r.active?'Desativar':'Ativar'}</button></form><form action={deleteProduct}><input type="hidden" name="id" value={r.id}/><ConfirmDeleteButton label="Eliminar" message="Eliminar este produto? Se já tiver histórico, será apenas desativado."/></form></div>
    </article>)}</div>
  </AdminPage>;
}
