"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { UserInputError } from "@/lib/action-error";

function text(fd:FormData,key:string,max:number) {return String(fd.get(key)||"").trim().slice(0,max);}
function integer(fd:FormData,key:string,min=1,max=10000000) {
  const n=Number(fd.get(key));
  if(!Number.isSafeInteger(n)||n<min||n>max)throw new UserInputError("Preencha os identificadores e quantidades com valores válidos.");
  return n;
}
async function perform(action:()=>Promise<void>) {
  await requireAdmin();
  try {await action();for(const path of ["/admin/storage","/stock-map","/production","/lot-dispatch","/traceability"])revalidatePath(path);return {ok:true as const};}
  catch(error) {
    if(error instanceof UserInputError)return {ok:false as const,message:error.message};
    if((error as {code?:string}).code==="ER_DUP_ENTRY")return {ok:false as const,message:"Já existe essa posição física ou código de lote. Edite o registo existente."};
    const reference=crypto.randomUUID();console.error("[storage-admin]",reference,error);
    return {ok:false as const,message:`Não foi possível guardar. Confirme o estado antes de repetir. Referência: ${reference}`};
  }
}
export async function saveStorageLocation(fd:FormData) {
  const admin=await requireAdmin();
  return perform(async()=>{
    const id=fd.get("id")?integer(fd,"id"):null;
    const warehouseCode=text(fd,"warehouseCode",8).toUpperCase(),warehouseName=text(fd,"warehouseName",64),code=text(fd,"code",16),zoneType=text(fd,"zoneType",16);
    if(!/^[A-Z0-9_-]+$/.test(warehouseCode)||!warehouseName||!code||!["STACK","PALLET"].includes(zoneType))throw new UserInputError("Preencha o armazém, a posição e o tipo de espaço.");
    const data={warehouseCode,warehouseName:warehouseCode==="W1"?"Armazém Sede":warehouseCode==="W2"?"Armazém Zona Industrial":warehouseName,code,zoneType,rowNumber:integer(fd,"rowNumber",1,100),columnNumber:integer(fd,"columnNumber",1,30),active:true};
    await db.$transaction(async tx=>{
      if(id){
        const [current]=await tx.query<any[]>("SELECT * FROM StorageLocation WHERE id=? FOR UPDATE",[id]);
        if(!current)throw new UserInputError("A posição já não existe.");
        await tx.storageLocation.update({where:{id},data});
      }else await tx.storageLocation.create({data});
      await tx.auditLog.create({data:{userId:admin.id,action:id?"EDIT":"CREATE",entity:"StorageLocation",entityId:id?String(id):`${warehouseCode}:${code}`,details:data}});
    });
  });
}
export async function removeStorageLocation(fd:FormData) {
  const admin=await requireAdmin();
  return perform(async()=>{
    const id=integer(fd,"id");
    await db.$transaction(async tx=>{
      const [location]=await tx.query<any[]>("SELECT id FROM StorageLocation WHERE id=? FOR UPDATE",[id]);
      if(!location)throw new UserInputError("A posição já não existe.");
      const [stock]=await tx.query<any[]>("SELECT COALESCE(SUM(quantityPackages),0) AS total FROM ProductionStorageBalance WHERE locationId=?",[id]);
      if(Number(stock.total)>0)throw new UserInputError("Esta posição contém stock. Transfira-o no Mapa de Stock antes de remover a posição.");
      const [pending]=await tx.query<any[]>("SELECT COUNT(*) AS total FROM ProductionStorageMovement m JOIN LotDispatch d ON d.id=m.lotDispatchId WHERE m.fromLocationId=? AND m.movementType='DISPATCH' AND d.cancelledAt IS NULL",[id]);
      if(Number(pending.total)>0)throw new UserInputError("Esta posição está ligada a saídas que ainda podem ser anuladas. Mantenha-a para permitir a reposição do stock.");
      await tx.storageLocation.update({where:{id},data:{active:false}});
      await tx.auditLog.create({data:{userId:admin.id,action:"DEACTIVATE",entity:"StorageLocation",entityId:String(id)}});
    });
  });
}
export async function addOpeningStock(fd:FormData) {
  const admin=await requireAdmin();
  return perform(async()=>{
    const productId=integer(fd,"productId"),machineId=integer(fd,"machineId"),locationId=integer(fd,"locationId"),quantity=integer(fd,"quantityPackages");
    const lotCode=text(fd,"lotCode",120),notes=text(fd,"notes",500);
    const requestId=String(fd.get("requestId")??"");
    if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new UserInputError("Atualize a página antes de registar o stock.");
    const requestHash=createHash("sha256").update(JSON.stringify({productId,machineId,locationId,quantity,lotCode,notes})).digest("hex");
    if(!lotCode)throw new UserInputError("Indique o código do lote já existente no stock.");
    await db.$transaction(async tx=>{
      const [machine]=await tx.query<any[]>("SELECT id FROM Machine WHERE id=? AND active=1 FOR UPDATE",[machineId]);
      const [product]=await tx.query<any[]>("SELECT * FROM Product WHERE id=? AND active=1 FOR UPDATE",[productId]);
      const [location]=await tx.query<any[]>("SELECT id FROM StorageLocation WHERE id=? AND active=1 FOR UPDATE",[locationId]);
      if(!machine||!product||!location)throw new UserInputError("Selecione um produto, máquina de origem e posição ativos.");
      const units=product.productionUnit==="UNIT"?1:Number(product.unitsPerPackage);
      if(!Number.isSafeInteger(units)||units<1)throw new UserInputError("Configure as unidades por saco/palete deste produto antes de dar entrada de stock.");
      const [request]=await tx.query<any[]>("SELECT requestHash FROM OpeningStockRequest WHERE requestId=? FOR UPDATE",[requestId]);
      if(request){if(request.requestHash!==requestHash)throw new UserInputError("Esta entrada já foi guardada com outros dados. Atualize a página antes de criar uma nova entrada.");return;}
      const saved=await tx.production.create({data:{machineId,productId,operatorId:admin.id,productionLot:lotCode,shiftCode:"INITIAL",status:"FINALIZED",recordOrigin:"INITIAL_STOCK",quantityProduced:quantity,unitsPerPackageSnapshot:units,productionUnitSnapshot:product.productionUnit,finalizedAt:new Date(),observations:notes||"Entrada de stock anterior à utilização da aplicação."}});
      await tx.execute("INSERT INTO OpeningStockRequest (requestId,requestHash,productionId) VALUES (?,?,?)",[requestId,requestHash,saved.id]);
      await tx.productionStorageBalance.create({data:{productionId:saved.id,locationId,quantityPackages:quantity}});
      await tx.productionStorageMovement.create({data:{productionId:saved.id,movementType:"INITIAL_STOCK",toLocationId:locationId,quantityPackages:quantity,createdById:admin.id,reason:notes||"Stock inicial"}});
      await tx.auditLog.create({data:{userId:admin.id,action:"CREATE",entity:"OpeningStock",entityId:String(saved.id),details:{lotCode,productId,machineId,locationId,quantity,unitsPerPackage:units}}});
    });
  });
}
