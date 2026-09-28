"use server";

import { UserInputError } from "@/lib/action-error";
import { getShiftWindowForDate, formatLocalDateInput, type ShiftCode } from "@/lib/shift";
import { RecordStatus } from "@/lib/db-types";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { getRecordedProductionStock, reconcileProductionStock, replaceRecordedProductionStock } from "@/lib/raw-material-stock";

export async function cancelProduction(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new UserInputError("Produção inválida.");

  await db.$transaction(async (tx) => {
    const rows = await tx.query<{ id: number; status: RecordStatus; updatedAt: Date }[]>(
      "SELECT id, status, updatedAt FROM Production WHERE id=? FOR UPDATE",
      [id],
    );
    const production = rows[0];
    if (!production) throw new UserInputError("A produção já não existe.");
    if(formData.has("expectedUpdatedAt")&&new Date(production.updatedAt).toISOString()!==formData.get("expectedUpdatedAt"))throw new UserInputError("A produção mudou. Atualize a página antes de eliminar.");
    if (production.status === RecordStatus.CANCELLED) throw new UserInputError("A produção já se encontra cancelada.");

    const dispatches = await tx.query<{ total: number | string }[]>(
      `SELECT COUNT(*) AS total
       FROM LotDispatchLine line
       INNER JOIN LotDispatch d ON d.id=line.lotDispatchId
       WHERE line.productionId=? AND d.cancelledAt IS NULL`,
      [id],
    );
    if (Number(dispatches[0]?.total ?? 0) > 0) {
      throw new UserInputError("Esta produção já tem saídas para clientes e não pode ser cancelada. Corrija primeiro os movimentos de expedição.");
    }

    const finishedBalances = await tx.query<{ locationId: number; quantityPackages: number | string }[]>(
      "SELECT locationId,quantityPackages FROM ProductionStorageBalance WHERE productionId=? FOR UPDATE",
      [id],
    );

    const recordedStock = await getRecordedProductionStock(tx, id);
    if (recordedStock.length) {
      await reconcileProductionStock(tx, recordedStock, []);
      await replaceRecordedProductionStock(tx, id, []);
    }

    for (const balance of finishedBalances) {
      const quantityPackages = Number(balance.quantityPackages);
      if (quantityPackages > 0) {
        await tx.productionStorageMovement.create({
          data: {
            productionId: id,
            movementType: "ADJUSTMENT",
            fromLocationId: Number(balance.locationId),
            toLocationId: null,
            quantityPackages,
            lotDispatchId: null,
            createdById: admin.id,
            reason: "Remoção de stock devido ao cancelamento da produção.",
          },
        });
      }
    }
    if (finishedBalances.length) {
      await tx.productionStorageBalance.deleteMany({ where: { productionId: id } });
    }

    await tx.production.update({
      where: { id },
      data: { status: RecordStatus.CANCELLED, finalizedAt: null },
    });
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "CANCEL",
        entity: "Production",
        entityId: String(id),
        details: { reason:String(formData.get("reason")??"Cancelamento administrativo").trim().slice(0,500), stockRestored: recordedStock.length > 0, finishedStockRemoved: finishedBalances.length > 0 },
      },
    });
  });

  refreshProductionViews(id);
  revalidatePath("/admin/productions");
  revalidatePath("/production");
  revalidatePath("/admin/raw-material-lots");
  revalidatePath("/stock-map");
  revalidatePath("/lot-dispatch");
  revalidatePath("/traceability");
}

export async function correctProductionRecord(fd:FormData){
  const admin=await requireAdmin();
  try{
    const id=Number(fd.get("id"));
    const productId=Number(fd.get("productId")),operatorId=Number(fd.get("operatorId"));
    const quantityRaw=String(fd.get("quantityProduced")??"").trim();
    const quantity=quantityRaw===""?null:Number(quantityRaw);
    const reason=String(fd.get("reason")??"").trim().slice(0,500);
    if(![id,productId,operatorId].every(n=>Number.isInteger(n)&&n>0))throw new UserInputError("Selecione uma produção, artigo e operador válidos.");
    if(!reason)throw new UserInputError("Indique o motivo da correção.");
    if(quantity!==null&&(!Number.isInteger(quantity)||quantity<0||quantity>10000000))throw new UserInputError("A quantidade deve ser um número inteiro entre 0 e 10 milhões.");
    await db.$transaction(async tx=>{
      // Match normal production/import locks before changing the period or article.
      await tx.query("SELECT id FROM Machine ORDER BY id FOR UPDATE");
      await tx.query("SELECT id FROM Product ORDER BY id FOR UPDATE");
      const [row]=await tx.query<any[]>("SELECT * FROM Production WHERE id=? FOR UPDATE",[id]);
      if(!row||row.status==="CANCELLED")throw new UserInputError("A produção já não existe ou foi eliminada.");
      if(new Date(row.updatedAt).toISOString()!==fd.get("expectedUpdatedAt"))throw new UserInputError("A produção foi alterada. Atualize a página antes de corrigir.");
      if(row.status==="FINALIZED"&&quantity===null)throw new UserInputError("Uma produção finalizada tem de ter quantidade.");
      const product=await tx.product.findUnique({where:{id:productId}});
      const originalProduct=await tx.product.findUnique({where:{id:row.productId}});
      const operator=await tx.user.findUnique({where:{id:operatorId}});
      if(!product||!operator)throw new UserInputError("O artigo ou operador já não existe.");
      if(productId!==row.productId){
        const allowed=await tx.query<any[]>("SELECT machineId FROM ProductMachine WHERE productId=? AND machineId=?",[productId,row.machineId]);
        if(!allowed.length)throw new UserInputError("A variante selecionada não está autorizada para esta máquina.");
        const units=Number(row.unitsPerPackageSnapshot??originalProduct.unitsPerPackage);
        if(Number(product.unitsPerPackage)!==units||product.productionUnit!==(row.productionUnitSnapshot??originalProduct.productionUnit))throw new UserInputError("A variante deve usar a mesma unidade e quantidade por embalagem deste registo.");
      }
      let startedAt=new Date(row.startedAt),shiftCode=String(row.shiftCode);
      if(row.recordOrigin!=="INITIAL_STOCK"){
        let window;
        try{window=getShiftWindowForDate(String(fd.get("date")??""),String(fd.get("shiftCode")??"") as ShiftCode);}catch{throw new UserInputError("Selecione uma data e um turno válidos.");}
        if(window.start>new Date())throw new UserInputError("Não pode mover a produção para um turno futuro.");
        if(formatLocalDateInput(startedAt)!==formatLocalDateInput(window.start)||shiftCode!==window.code){startedAt=window.start;shiftCode=window.code;}
        const changedPeriod=startedAt.getTime()!==new Date(row.startedAt).getTime()||productId!==row.productId;
        if(changedPeriod){
          const duplicates=await tx.production.count({where:{id:{not:id},machineId:row.machineId,productId,startedAt:{gte:window.start,lt:window.end},recordOrigin:{in:["PRODUCTION","HISTORICAL_IMPORT"]},status:{not:"CANCELLED"}}});
          if(duplicates&&fd.get("allowAdditional")!=="on")throw new UserInputError("Já existe uma produção deste artigo, máquina e turno. Confirme que é um registo adicional ou elimine o duplicado.");
        }
      }
      const [outbound]=await tx.query<any[]>(`SELECT COUNT(*) AS entries,COALESCE(SUM(line.quantityUnits),0) AS units FROM LotDispatchLine line JOIN LotDispatch d ON d.id=line.lotDispatchId WHERE line.productionId=? AND d.cancelledAt IS NULL`,[id]);
      if(productId!==row.productId&&Number(outbound.entries)>0)throw new UserInputError("Este lote já foi expedido. Corrija primeiro as saídas antes de mudar de artigo.");
      const balances=await tx.query<any[]>("SELECT locationId,quantityPackages FROM ProductionStorageBalance WHERE productionId=? ORDER BY locationId FOR UPDATE",[id]);
      const snapshot=JSON.stringify(balances.map(b=>[Number(b.locationId),Number(b.quantityPackages)]));
      if(snapshot!==fd.get("expectedBalances"))throw new UserInputError("O stock desta produção mudou. Atualize a página e confirme as quantidades.");
      const allocations=balances.map(b=>{
        const raw=fd.get(`balance_${b.locationId}`);const amount=raw===null?Number(b.quantityPackages):Number(raw);
        if(!Number.isInteger(amount)||amount<0||amount>10000000)throw new UserInputError("Uma quantidade no armazém é inválida.");
        return {...b,amount};
      });
      const units=Number(row.unitsPerPackageSnapshot??originalProduct.unitsPerPackage);
      const dispatched=Number(outbound.units);
      if(row.recordOrigin!=="HISTORICAL_IMPORT"&&row.status==="FINALIZED"){
        if(units<=0||dispatched%units!==0)throw new UserInputError("As saídas não correspondem a embalagens completas. Corrija primeiro a expedição.");
        if(allocations.reduce((sum,b)=>sum+b.amount,0)+dispatched/units>(quantity??0))throw new UserInputError("A quantidade produzida é inferior ao stock localizado mais as saídas. Corrija também as quantidades das posições neste formulário.");
      }
      if(row.recordOrigin==="HISTORICAL_IMPORT"&&balances.length)throw new UserInputError("Este histórico tem movimentos físicos inesperados. Reveja os movimentos antes de o corrigir.");
      for(const balance of allocations){
        const delta=balance.amount-Number(balance.quantityPackages);if(!delta)continue;
        if(balance.amount===0)await tx.productionStorageBalance.delete({where:{productionId:id,locationId:balance.locationId}});
        else await tx.productionStorageBalance.update({where:{productionId:id,locationId:balance.locationId},data:{quantityPackages:balance.amount}});
        await tx.productionStorageMovement.create({data:{productionId:id,movementType:"ADJUSTMENT",fromLocationId:delta<0?balance.locationId:null,toLocationId:delta>0?balance.locationId:null,quantityPackages:Math.abs(delta),createdById:admin.id,reason}});
      }
      if(productId!==row.productId){
        const [association]=await tx.query<any[]>("SELECT labelCode FROM ProductionLotAssociation WHERE productionId=?",[id]);
        if(association){
          await tx.execute("INSERT INTO ProductLotHistory (productId,scope,previousPrefix,newPrefix,previousCode,newCode,reason,changedById) VALUES (?,'CORRECTION',?,?,?,?,?,?)",[productId,row.productionLot.slice(0,2),row.productionLot.slice(0,2),row.productionLot,row.productionLot,reason,admin.id]);
          await tx.execute("INSERT INTO ProductionLotAlias (productionId,historyId,oldCode,oldLabel) VALUES (?,LAST_INSERT_ID(),?,?)",[id,row.productionLot,association.labelCode]);
          await tx.execute("DELETE FROM ProductionLotAssociation WHERE productionId=?",[id]);
        }
      }
      const data={productId,operatorId,startedAt,shiftCode,quantityProduced:quantity,observations:String(fd.get("observations")??"").trim().slice(0,500)||null};
      await tx.production.update({where:{id},data});
      await tx.auditLog.create({data:{userId:admin.id,action:"ADMIN_CORRECTION",entity:"Production",entityId:String(id),details:{reason,previous:{productId:row.productId,operatorId:row.operatorId,startedAt:row.startedAt,shiftCode:row.shiftCode,quantityProduced:row.quantityProduced,observations:row.observations},next:data,previousBalances:balances,nextBalances:allocations.map(b=>({locationId:b.locationId,quantityPackages:b.amount})),lotPreserved:row.productionLot,rawMaterialConsumptionUnchanged:true}}});
    });
    refreshProductionViews(id);
    return {ok:true,message:"Produção corrigida. A data e o turno foram atualizados; o código de lote e as leituras foram conservados."};
  }catch(error){return productionAdminFailure(error);}
}

function refreshProductionViews(id:number){for(const path of ["/admin/productions",`/admin/productions/${id}`,`/production/${id}`,"/production","/stock-map","/lot-dispatch","/traceability","/scoreboards","/dashboard","/admin"])revalidatePath(path);}
function productionAdminFailure(error:unknown){
  if(error instanceof UserInputError)return {ok:false,message:error.message};
  console.error("[production-admin]",error);return {ok:false,message:"Não foi possível guardar. Atualize a página para confirmar o estado antes de repetir."};
}
export async function deleteProductionRecord(fd:FormData){
  await requireAdmin();
  try{
    if(!String(fd.get("reason")??"").trim())throw new UserInputError("Indique o motivo da eliminação.");
    await cancelProduction(fd);
    return {ok:true,message:"Produção eliminada dos registos ativos e contadores. Foi conservada no histórico de auditoria."};
  }catch(error){return productionAdminFailure(error);}
}
