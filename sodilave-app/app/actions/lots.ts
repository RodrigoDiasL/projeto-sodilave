"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { UserInputError } from "@/lib/action-error";
import { generatedLotPattern } from "@/lib/lot-code";
async function requireLotManager(){const user=await requireUser();if(!["ADMIN","PRODUCTION_MANAGER"].includes(user.role))throw new UserInputError("Não tem permissão para alterar lotes.");return user;}
function input(fd:FormData){
  const productId=Number(fd.get("productId")),majorLetter=String(fd.get("majorLetter")||"").trim().toUpperCase(),minorLetter=String(fd.get("minorLetter")||"").trim().toUpperCase(),reason=String(fd.get("reason")||"").trim();
  if(!Number.isSafeInteger(productId)||productId<1||!/[A-Z]/.test(majorLetter)||majorLetter.length!==1||!/[A-Z]/.test(minorLetter)||minorLetter.length!==1)throw new UserInputError("Selecione o produto e uma letra de A a Z em cada campo.");
  if(!reason||reason.length>2000)throw new UserInputError("Explique a alteração e o motivo (até 2000 caracteres).");
  return {productId,majorLetter,minorLetter,reason,prefix:majorLetter+minorLetter};
}
async function feedback(action:()=>Promise<void>){
  try{await action();for(const path of ["/commercial-lots","/production","/admin/productions","/stock-map","/lot-dispatch","/traceability","/admin/production-display"])revalidatePath(path);return {ok:true as const};}
  catch(error){if(error instanceof UserInputError)return {ok:false as const,message:error.message};const reference=crypto.randomUUID();console.error("[product-lots]",reference,error);return {ok:false as const,message:`Não foi possível guardar a alteração. Atualize a página para confirmar o estado. Referência: ${reference}`};}
}
export async function saveProductLotConfig(fd:FormData){
  const user=await requireLotManager();
  return feedback(async()=>{
    const data=input(fd),expectedVersion=Number(fd.get("expectedVersion"));
    if(!fd.has("expectedVersion")||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new UserInputError("Atualize a página antes de alterar as letras.");
    await db.$transaction(async tx=>{
      const [product]=await tx.query<any[]>("SELECT id FROM Product WHERE id=? AND active=1 FOR UPDATE",[data.productId]);
      if(!product)throw new UserInputError("Este produto não existe ou está inativo.");
      const [config]=await tx.query<any[]>("SELECT * FROM ProductLotConfig WHERE productId=? FOR UPDATE",[data.productId]);
      const previous=(config?.majorLetter??"A")+(config?.minorLetter??"A");
      if(Number(config?.version??0)!==expectedVersion)throw new UserInputError("As letras foram alteradas por outro utilizador. Atualize a página.");
      if(previous===data.prefix)throw new UserInputError("As letras não foram alteradas.");
      await tx.execute("INSERT INTO ProductLotConfig (productId,majorLetter,minorLetter,version,updatedById) VALUES (?,?,?,1,?) ON DUPLICATE KEY UPDATE majorLetter=VALUES(majorLetter),minorLetter=VALUES(minorLetter),version=version+1,updatedById=VALUES(updatedById)",[data.productId,data.majorLetter,data.minorLetter,user.id]);
      await tx.execute("INSERT INTO ProductLotHistory (productId,scope,previousPrefix,newPrefix,reason,changedById) VALUES (?,'FUTURE',?,?,?,?)",[data.productId,previous,data.prefix,data.reason,user.id]);
      await tx.auditLog.create({data:{userId:user.id,action:"CHANGE_CONFIG",entity:"ProductLotConfig",entityId:String(data.productId),details:{previous,next:data.prefix,reason:data.reason}}});
    });
  });
}
export async function editProducedLot(fd:FormData){
  const user=await requireLotManager();
  return feedback(async()=>{
    const data=input(fd),oldCode=String(fd.get("expectedCode")||""),expectedCount=Number(fd.get("expectedCount"));
    if(!generatedLotPattern.test(oldCode)||!Number.isSafeInteger(expectedCount)||expectedCount<1)throw new UserInputError("Selecione um lote gerado pela aplicação e atualize a página.");
    const newCode=data.prefix+oldCode.slice(2);
    if(newCode===oldCode)throw new UserInputError("As letras não foram alteradas.");
    await db.$transaction(async tx=>{
      const [product]=await tx.query<any[]>("SELECT id FROM Product WHERE id=? FOR UPDATE",[data.productId]);
      if(!product)throw new UserInputError("O produto já não existe.");
      const rows=await tx.query<any[]>("SELECT id FROM Production WHERE productId=? AND productionLot=? AND status<>'CANCELLED' AND recordOrigin='PRODUCTION' ORDER BY id FOR UPDATE",[data.productId,oldCode]);
      if(rows.length!==expectedCount)throw new UserInputError("O lote mudou desde que abriu a página. Atualize e confirme novamente.");
      const [conflict]=await tx.query<any[]>("SELECT id FROM Production WHERE productId=? AND productionLot=? AND status<>'CANCELLED' LIMIT 1",[data.productId,newCode]);
      if(conflict)throw new UserInputError("Esse código já identifica outro lote deste produto. Escolha outras letras para não juntar lotes diferentes.");
      await tx.execute("INSERT INTO ProductLotHistory (productId,scope,previousPrefix,newPrefix,previousCode,newCode,reason,changedById) VALUES (?,'EXISTING',?,?,?,?,?,?)",[data.productId,oldCode.slice(0,2),data.prefix,oldCode,newCode,data.reason,user.id]);
      const [history]=await tx.query<any[]>("SELECT LAST_INSERT_ID() AS id");
      for(const row of rows){
        const [association]=await tx.query<any[]>("SELECT labelCode FROM ProductionLotAssociation WHERE productionId=?",[row.id]);
        await tx.execute("INSERT INTO ProductionLotAlias (productionId,historyId,oldCode,oldLabel) VALUES (?,?,?,?)",[row.id,history.id,oldCode,association?.labelCode??null]);
        await tx.production.update({where:{id:row.id},data:{productionLot:newCode}});
        await tx.execute("UPDATE ProductionLotAssociation SET internalCode=?,labelCode=? WHERE productionId=?",[newCode,newCode,row.id]);
      }
      await tx.auditLog.create({data:{userId:user.id,action:"EDIT_LOT",entity:"ProductLot",entityId:String(data.productId),details:{oldCode,newCode,productionIds:rows.map(r=>r.id),reason:data.reason}}});
    });
  });
}
