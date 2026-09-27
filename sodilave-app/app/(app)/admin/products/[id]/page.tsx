import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuditAccess } from "@/lib/auth";
import { AdminPage } from "@/components/AdminPage";

export default async function ProductDetails({params}:{params:Promise<{id:string}>}){
  const user=await requireAuditAccess();
  const {id}=await params; const product=await db.product.findUnique({where:{id:Number(id)},include:{_count:{select:{productions:true}}}}); if(!product)notFound();
  return <AdminPage title={product.name} subtitle="Detalhes e propriedades do produto."><section className="panel product-detail-panel"><div className="detail-grid"><p><strong>Código:</strong> {product.code}</p><p><strong>Estado:</strong> {product.active?'Ativo':'Inativo'}</p><p><strong>Unidades por embalagem:</strong> {product.unitsPerPackage??'Não definido'}</p><p><strong>Unidade de produção / stock:</strong> {product.productionUnit==='UNIT'?'Unidade':product.productionUnit==='PALLET'?'Palete':'Saco'}</p><p><strong>Produções associadas:</strong> {product._count.productions}</p><p><strong>Criado em:</strong> {product.createdAt.toLocaleString('pt-PT')}</p><p><strong>Última alteração:</strong> {product.updatedAt.toLocaleString('pt-PT')}</p></div><div className="button-row"><Link className="btn secondary" href="/admin/products">Voltar</Link>{user.role==="ADMIN"&&<Link className="btn primary" href={`/admin/products/${product.id}/edit`}>Editar produto</Link>}</div></section></AdminPage>;
}
