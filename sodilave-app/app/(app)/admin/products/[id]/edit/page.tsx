import { ProductUnitFields } from "@/components/ProductUnitFields";
import { FeedbackForm } from "@/components/FeedbackForm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { updateProduct } from "@/app/actions/admin";
import { AdminPage } from "@/components/AdminPage";

type LinkRow={machineId:number};

export default async function EditProduct({params}:{params:Promise<{id:string}>}){
  await requireAdmin();
  const {id}=await params;
  const productId=Number(id);
  const [product,machines,links]=await Promise.all([
    db.product.findUnique({where:{id:productId}}),
    db.machine.findMany({where:{active:true},orderBy:{code:"asc"},select:{id:true,code:true,name:true}}),
    db.$queryRaw<LinkRow[]>`SELECT machineId FROM ProductMachine WHERE productId=${productId}`,
  ]);
  if(!product)notFound();
  const selected=new Set(links.map(l=>l.machineId));
  return <AdminPage title={`Editar ${product.name}`} subtitle="Alterar as propriedades e as máquinas autorizadas para este produto."><FeedbackForm action={updateProduct} className="panel form-stack product-edit-page"><input type="hidden" name="id" value={product.id}/><div className="two-col"><label>Código<input name="code" defaultValue={product.code} required/></label><label>Designação<input name="name" defaultValue={product.name} required/></label><ProductUnitFields unit={product.productionUnit??"BAG"} count={product.unitsPerPackage}/><label className="check product-active-check"><input name="active" type="checkbox" defaultChecked={product.active}/>Produto ativo</label></div><fieldset><legend>Máquinas que produzem este artigo *</legend><div className="machine-checkbox-grid">{machines.map(m=><label className="check" key={m.id}><input type="checkbox" name="machineIds" value={m.id} defaultChecked={selected.has(m.id)}/><strong>Máquina {m.code}</strong><span>{m.name}</span></label>)}</div></fieldset><div className="button-row"><button className="btn primary">Guardar alterações</button></div></FeedbackForm></AdminPage>;
}
