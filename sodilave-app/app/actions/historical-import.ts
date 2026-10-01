"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { prepareHistoricalImport, importHash, type ImportMapping } from "@/lib/historical-import";
import { prepareHistoricalChecks } from "@/lib/historical-import-checks";

function read(fd:FormData){
  const content=String(fd.get("content")??""),name=String(fd.get("fileName")??"historico.json").slice(0,200);
  let mapping:ImportMapping;
  try{mapping=JSON.parse(String(fd.get("mapping")??"{}"));}catch{throw new Error("Associações inválidas.");}
  if(!mapping||typeof mapping!=="object")throw new Error("Associações inválidas.");
  return {content,name,mapping};
}
function message(error:unknown){
  console.error("[historical-import]",error);
  return error instanceof Error&&!(error as any).code?error.message:"Não foi possível importar. Nenhum registo desta tentativa foi gravado. Reveja a ligação e tente novamente.";
}

export async function previewHistoricalImport(fd:FormData){
  await requireAdmin();
  try{
    const input=read(fd);
    const p=await prepareHistoricalImport(input.content,input.mapping);
    const c=await prepareHistoricalChecks(input.content,input.mapping);
    return {
      ok:true as const,
      hash:importHash([p.hash,c.hash]),
      errors:p.errors+c.errors,
      newCount:p.newCount,
      duplicateCount:p.duplicateCount,
      newCheckCount:c.newCount,
      duplicateCheckCount:c.duplicateCount,
      rows:p.items.map(p=>({
        index:p.row.index,date:p.row.date,shift:p.row.shift,machine:p.machineCode,product:p.productName,
        operator:p.operatorName,lot:p.normalized.code,quantity:p.normalized.quantity,unit:p.normalized.unit,
        units:p.normalized.units,errors:p.errors,warnings:p.warnings,duplicate:p.duplicate
      })),
      checkRows:c.items.map((item,index)=>({
        index:index+1,date:item.date,shift:item.shift,type:item.kind,machine:item.machineCode??"—",
        operator:item.operatorName,errors:item.errors,warnings:item.warnings,duplicate:item.duplicate
      })),
    };
  }catch(error){return {ok:false as const,message:message(error)};}
}

export async function commitHistoricalImport(fd:FormData){
  const admin=await requireAdmin();
  try{
    if(fd.get("confirmed")!=="yes")throw new Error("Confirme que reviu a pré-visualização.");
    const input=read(fd),expected=String(fd.get("previewHash")??"");
    const result=await db.$transaction(async tx=>{
      // Serializa contra produção normal, stock inicial e outras importações.
      await tx.query("SELECT id FROM Machine ORDER BY id FOR UPDATE");
      await tx.query("SELECT id FROM Product ORDER BY id FOR UPDATE");
      await tx.query("SELECT id FROM User ORDER BY id FOR UPDATE");

      const p=await prepareHistoricalImport(input.content,input.mapping,tx);
      const c=await prepareHistoricalChecks(input.content,input.mapping,tx);
      if(p.errors+c.errors)throw new Error("Existem erros no ficheiro. Volte a pré-visualizar e corrija-os.");
      if(importHash([p.hash,c.hash])!==expected)throw new Error("Os dados ou os registos existentes mudaram. Volte a pré-visualizar antes de importar.");
      if(!p.newCount&&!c.newCount)return {created:0,skipped:p.duplicateCount,checksCreated:0,checksSkipped:c.duplicateCount};

      await tx.execute("INSERT INTO HistoricalImportBatch (fileName,fileHash,importedById) VALUES (?,?,?)",[input.name,importHash(input.content),admin.id]);
      const [batch]=await tx.query<any[]>("SELECT LAST_INSERT_ID() AS id");

      for(const item of p.items){
        if(item.duplicate)continue;
        const n=item.normalized;
        const production=await tx.production.create({data:{
          machineId:n.machineId,productId:n.productId,operatorId:n.operatorId,productionLot:n.code,
          shiftCode:n.shift,startedAt:item.start,finalizedAt:item.end,status:"FINALIZED",
          recordOrigin:"HISTORICAL_IMPORT",quantityProduced:n.quantity,productionUnitSnapshot:n.unit,
          unitsPerPackageSnapshot:n.units,initialWeightG:n.initialWeightG,midWeightG:n.midWeightG,
          observations:`Importação histórica #${batch.id}. Sem entrada em stock nem consumo de MPs atuais.\n${n.notes}`
        }});
        for(const [key,result] of Object.entries(n.tests))await tx.qualityTest.create({data:{
          productionId:production.id,type:key.startsWith("leak")?"LEAK":"DROP",
          moment:key.endsWith("Start")?"START":"MID",result
        }});
        for(const material of n.materials)await tx.productionMaterial.create({data:{productionId:production.id,...material}});
        await tx.execute(
          "INSERT INTO HistoricalImportItem (batchId,productionId,recordKey,contentHash,payloadJson) VALUES (?,?,?,?,?)",
          [batch.id,production.id,item.recordKey,item.contentHash,JSON.stringify({original:item.row.source,normalized:n,warnings:item.warnings})]
        );
      }

      for(const item of c.items){
        if(item.duplicate)continue;
        const n=item.normalized;
        let entityId:number;
        let entity:string;
        if(item.kind==="GENERAL"){
          const saved=await tx.shiftGeneralCheck.create({data:{
            operatorId:n.operatorId,shiftCode:n.shift,status:"FINALIZED",observedAt:item.start,finalizedAt:item.end,
            chillerLargeC:n.chillerLargeC,chillerSmallC:n.chillerSmallC,ambientTempC:n.ambientTempC,
            cleanDispatch:false,cleanStorage:false,cleanProduction:false,notes:n.notes
          }});
          entity="ShiftGeneralCheck";entityId=saved.id;
        }else{
          const saved=await tx.machineCheckup.create({data:{
            machineId:n.machineId,operatorId:n.operatorId,shiftCode:n.shift,status:"FINALIZED",
            observedAt:item.start,finalizedAt:item.end,oilTempStatus:n.oilTempStatus,oilLevel:n.oilLevel,
            waterPressure:n.waterPressure,airPressure:n.airPressure,cleanMachineArea:false,
            hasBreakdown:false,breakdownStoppedMachine:false,breakdownDescription:null,notes:n.notes
          }});
          entity="MachineCheckup";entityId=saved.id;
        }
        await tx.execute(
          "INSERT INTO HistoricalImportCheckItem (batchId,entity,entityId,recordKey,contentHash,payloadJson) VALUES (?,?,?,?,?,?)",
          [batch.id,entity,entityId,item.recordKey,item.contentHash,JSON.stringify({original:item.source,normalized:n,warnings:item.warnings})]
        );
      }

      await tx.auditLog.create({data:{
        userId:admin.id,action:"IMPORT",entity:"HistoricalImportBatch",entityId:String(batch.id),
        details:{fileName:input.name,created:p.newCount,skipped:p.duplicateCount,
          checksCreated:c.newCount,checksSkipped:c.duplicateCount,stockChanged:false}
      }});
      return {created:p.newCount,skipped:p.duplicateCount,checksCreated:c.newCount,checksSkipped:c.duplicateCount};
    });

    for(const path of ["/admin/import-history","/admin/productions","/admin/checkups","/production","/checkups","/traceability","/scoreboards","/dashboard"])revalidatePath(path);
    return {ok:true as const,...result};
  }catch(error){return {ok:false as const,message:message(error)};}
}
