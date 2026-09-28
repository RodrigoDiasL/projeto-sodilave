import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/auth";
import {db} from "@/lib/db";
import {AdminPage} from "@/components/AdminPage";
import {FeedbackForm} from "@/components/FeedbackForm";
import {createProductVariant} from "@/app/actions/product-variants";
export default async function Page({params}:{params:Promise<{id:string}>}){
  await requireAdmin();const {id}=await params;const product=await db.product.findUnique({where:{id:Number(id)}});if(!product)notFound();
  const isJerrycan=/jerrycan/i.test(product.name)&&/5\s*l\b/i.test(product.name);
  const family=product.stockFamily||(isJerrycan?"Jerrycan 5 L":"");
  return <AdminPage title="Criar variante do artigo" subtitle="Cada variante tem código, stock e rastreabilidade próprios, com um total conjunto por família."><FeedbackForm action={createProductVariant} className="panel form-stack"><input type="hidden" name="id" value={product.id}/><input type="hidden" name="expectedName" value={product.name}/>
    <p>Serão copiadas as unidades por embalagem, as máquinas autorizadas e as letras para novos lotes. O stock e o histórico atuais permanecem no artigo original.</p>
    <label>Nome do artigo original<input name="originalName" maxLength={120} defaultValue={isJerrycan&&!/rosca|encaixe/i.test(product.name)?`${product.name} — Rosca`:product.name} required/></label>
    <label>Nome da nova variante<input name="name" maxLength={120} defaultValue={isJerrycan?`${product.name.replace(/\s*[—-]?\s*(rosca|encaixe)/ig,"")} — Encaixe`:""} required/></label>
    <label>Código da nova variante<input name="code" maxLength={40} placeholder="Código distinto do artigo original" required/></label>
    <label>Família para somar o stock<input name="stockFamily" maxLength={80} defaultValue={family} placeholder="Ex.: Jerrycan 5 L" required/></label>
    <p className="notice">Se parte do stock antigo for Encaixe, corrija o artigo dos respetivos registos em Produções. Criar a variante não duplica nem divide automaticamente o stock existente.</p>
    <button className="btn primary">Criar variante e guardar nomes</button><Link href="/admin/products" className="btn secondary">Voltar aos artigos</Link>
  </FeedbackForm></AdminPage>;
}
