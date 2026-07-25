import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { updateProduct } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";

export default async function EditProduct({params}:{params:Promise<{id:string}>}){
  await requireAdmin();
  const {id}=await params; const product=await db.product.findUnique({where:{id:Number(id)}}); if(!product)notFound();
  return <AdminPage title={`Editar ${product.name}`} subtitle="Alterar as propriedades do produto."><form action={updateProduct} className="panel form-stack product-edit-page"><input type="hidden" name="id" value={product.id}/><div className="two-col"><label>Código<input name="code" defaultValue={product.code} required/></label><label>Designação<input name="name" defaultValue={product.name} required/></label><label>Unidades por embalagem<input className="no-spinner" name="unitsPerPackage" type="number" min="1" step="1" defaultValue={product.unitsPerPackage??""} required/></label><label className="check product-active-check"><input name="active" type="checkbox" defaultChecked={product.active}/>Produto ativo</label></div><div className="button-row"><button className="btn primary">Guardar alterações</button></div></form></AdminPage>;
}
