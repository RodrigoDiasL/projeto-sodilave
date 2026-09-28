"use server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { UserInputError } from "@/lib/action-error";

export async function createProductVariant(fd:FormData){
  const admin=await requireAdmin();
  try{
    const id=Number(fd.get("id"));
    const field=(key:string,max:number)=>{const value=String(fd.get(key)??"").trim();if(!value||value.length>max)throw new UserInputError("Preencha os nomes, o código da variante e a família.");return value;};
    const originalName=field("originalName",120),name=field("name",120),code=field("code",40),stockFamily=field("stockFamily",80);
    if(!Number.isInteger(id)||id<=0||originalName.toLowerCase()===name.toLowerCase())throw new UserInputError("As duas variantes têm de ter nomes diferentes.");
    const created=await db.$transaction(async tx=>{
      const [base]=await tx.query<any[]>("SELECT * FROM Product WHERE id=? FOR UPDATE",[id]);
      if(!base)throw new UserInputError("O artigo original já não existe.");
      if(base.name!==fd.get("expectedName"))throw new UserInputError("O artigo foi alterado. Atualize a página.");
      if(await tx.product.findFirst({where:{code}}))throw new UserInputError("Este código já pertence a outro artigo. Escolha um código distinto.");
      const variant=await tx.product.create({data:{name,code,stockFamily,unitsPerPackage:base.unitsPerPackage,productionUnit:base.productionUnit,active:true}});
      await tx.execute("INSERT INTO ProductMachine (productId,machineId) SELECT ?,machineId FROM ProductMachine WHERE productId=?",[variant.id,id]);
      await tx.execute("INSERT INTO ProductLotConfig (productId,majorLetter,minorLetter,updatedById) SELECT ?,majorLetter,minorLetter,? FROM ProductLotConfig WHERE productId=?",[variant.id,admin.id,id]);
      await tx.product.update({where:{id},data:{name:originalName,stockFamily}});
      await tx.auditLog.create({data:{userId:admin.id,action:"CREATE_VARIANT",entity:"Product",entityId:String(variant.id),details:{originalId:id,previousName:base.name,originalName,name,code,stockFamily,stockCopied:false}}});
      return variant;
    });
    for(const path of ["/admin/products",`/admin/products/${id}`,"/production","/stock-map"])revalidatePath(path);
    return {ok:true,message:`Variante ${created.name} criada sem stock. O artigo original mantém o seu histórico.`};
  }catch(error){
    if(error instanceof UserInputError)return {ok:false,message:error.message};
    console.error("[product-variant]",error);return {ok:false,message:"Não foi possível criar a variante. Atualize a lista antes de repetir."};
  }
}
