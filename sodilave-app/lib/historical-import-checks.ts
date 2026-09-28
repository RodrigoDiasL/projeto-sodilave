import { db, type DbTransaction } from "@/lib/db";
import { getShiftWindowForDate, type ShiftCode } from "@/lib/shift";
import { importHash, type ImportMapping } from "@/lib/historical-import";

const value=(v:any)=>String(v??"").trim();
const optionalNumber=(v:any,min:number,max:number,label:string,errors:string[])=>{
  if(v===null||v===undefined||v==="")return null;
  const n=Number(String(v).replace(",","."));
  if(!Number.isFinite(n)||n<min||n>max){errors.push(`${label}: valor inválido.`);return null;}
  return n;
};

function jsonSheets(content:string){
  const text=content.replace(/^\uFEFF/,"").trim();
  if(!text||!["{","["].includes(text[0]))return [] as any[];
  let data:any;
  try{data=JSON.parse(text);}catch{return [] as any[];}
  if(Array.isArray(data))return data;
  if(Array.isArray(data.sheets))return data.sheets;
  return [data];
}

export type HistoricalCheckPrepared={
  kind:"GENERAL"|"MACHINE";
  date:string;
  shift:string;
  operatorId?:number;
  operatorName:string;
  machineId?:number;
  machineCode?:string;
  start?:Date;
  end?:Date;
  normalized:Record<string,any>;
  recordKey:string;
  contentHash:string;
  source:any;
  errors:string[];
  warnings:string[];
  duplicate:boolean;
};

export async function prepareHistoricalChecks(content:string,mapping:ImportMapping,client:DbTransaction=db){
  const sheets=jsonSheets(content);
  if(!sheets.length)return {items:[] as HistoricalCheckPrepared[],hash:importHash([]),errors:0,newCount:0,duplicateCount:0};

  const [users,machines]=await Promise.all([
    client.user.findMany({select:{id:true,name:true}}),
    client.machine.findMany({select:{id:true,name:true,code:true}}),
  ]);
  const prepared:HistoricalCheckPrepared[]=[];
  const seen=new Set<string>();

  for(const sheet of sheets){
    const date=value(sheet.shift?.date??sheet.date);
    const shift=value(sheet.shift?.code??sheet.shift).toUpperCase();
    if(!date||!["A","B","C"].includes(shift))continue;

    const worker=Array.isArray(sheet.shift?.workers)?sheet.shift.workers[0]:null;
    const operatorKey=value(worker?.rawText??worker?.name??sheet.operatorName??sheet.operador)
      || (Number(worker?.userId)?`ID ${Number(worker.userId)}`:"Operador não identificado");
    const operatorId=Number(mapping.operators?.[operatorKey]??worker?.userId)||undefined;
    const operator=users.find(u=>u.id===operatorId);

    let window:ReturnType<typeof getShiftWindowForDate>|undefined;
    const baseErrors:string[]=[];
    try{
      window=getShiftWindowForDate(date,shift as ShiftCode);
      if(window.end>new Date())baseErrors.push("Só é possível importar turnos já terminados.");
    }catch{baseErrors.push("Data inválida.");}
    if(!operator)baseErrors.push("Identifique o operador desta folha.");

    const general=sheet.generalCheck;
    if(general&&typeof general==="object"){
      const errors=[...baseErrors],warnings:string[]=[];
      const chillerLargeC=optionalNumber(general.chillerLargeC,-30,80,"Temperatura do refrigerador grande",errors);
      const chillerSmallC=optionalNumber(general.chillerSmallC,-30,80,"Temperatura do refrigerador pequeno",errors);
      const ambientTempC=optionalNumber(general.ambientTempC,-10,60,"Temperatura ambiente",errors);
      if([chillerLargeC,chillerSmallC,ambientTempC].some(v=>v===null))warnings.push("Uma ou mais temperaturas gerais não estavam registadas no papel.");
      const normalized={date,shift,operatorId:operator?.id,chillerLargeC,chillerSmallC,ambientTempC,
        notes:[value(sheet.paperObservations),"Importação histórica: limpezas gerais não reconstruídas a partir desta folha."].filter(Boolean).join("\n").slice(0,10000)};
      const recordKey=importHash(["ShiftGeneralCheck",date,shift]);
      if(seen.has(recordKey))errors.push("Verificação geral repetida no ficheiro.");seen.add(recordKey);
      const contentHash=importHash(normalized);let duplicate=false;
      if(!errors.length&&window){
        const [prior]=await client.query<any[]>("SELECT contentHash,entityId FROM HistoricalImportCheckItem WHERE entity='ShiftGeneralCheck' AND recordKey=?",[recordKey]);
        if(prior){
          const [row]=await client.query<any[]>("SELECT status FROM ShiftGeneralCheck WHERE id=?",[prior.entityId]);
          if(prior.contentHash===contentHash&&row?.status!=="CANCELLED")duplicate=true;
          else errors.push("Já existe uma verificação geral histórica diferente para este turno.");
        }else{
          const existing=await client.shiftGeneralCheck.count({where:{observedAt:{gte:window.start,lt:window.end},status:{not:"CANCELLED"}}});
          if(existing)errors.push("Já existe uma verificação geral neste turno. Reveja para evitar duplicação.");
        }
      }
      prepared.push({kind:"GENERAL",date,shift,operatorId:operator?.id,operatorName:operator?.name??operatorKey,start:window?.start,end:window?.end,normalized,recordKey,contentHash,source:sheet,errors,warnings,duplicate});
    }

    for(const check of Array.isArray(sheet.machineCheckups)?sheet.machineCheckups:[]){
      const errors=[...baseErrors],warnings:string[]=[];
      const machineKey=value(check.machineCode??check.machineId);
      const mapped=Number(mapping.machines?.[machineKey]??check.machineId)||undefined;
      const machine=machines.find(m=>m.id===mapped)??(!mapping.machines?.[machineKey]?machines.find(m=>String(m.code)===machineKey.replace(/^M(?:AQ(?:UINA)?)?\s*/i,"")):undefined);
      if(!machine)errors.push(`Associe a máquina ${machineKey||"?"}.`);
      const airPressure=optionalNumber(check.airPressure,0,50,`Máquina ${machineKey}: pressão de ar`,errors);
      const waterPressure=optionalNumber(check.waterPressure,0,50,`Máquina ${machineKey}: pressão de água`,errors);
      const oilTempStatus=value(check.oilTempStatus).toUpperCase()||"NORMAL";
      const oilLevel=value(check.oilLevel).toUpperCase()||"NORMAL";
      if(!["COLD","NORMAL","HOT","VERY_HOT"].includes(oilTempStatus))errors.push(`Máquina ${machineKey}: temperatura do óleo inválida.`);
      if(!["LOW","NORMAL","HIGH"].includes(oilLevel))errors.push(`Máquina ${machineKey}: nível do óleo inválido.`);
      if(airPressure===null)warnings.push(`Máquina ${machineKey}: pressão de ar não registada.`);
      if(waterPressure===null)warnings.push(`Máquina ${machineKey}: pressão de água não registada.`);
      const normalized={date,shift,operatorId:operator?.id,machineId:machine?.id,oilTempStatus,oilLevel,airPressure,waterPressure,
        notes:"Importação histórica: pressões comuns do circuito replicadas para a máquina; limpeza da área não reconstruída."};
      const recordKey=importHash(["MachineCheckup",date,shift,machine?.id??machineKey]);
      if(seen.has(recordKey))errors.push("Verificação de máquina repetida no ficheiro.");seen.add(recordKey);
      const contentHash=importHash(normalized);let duplicate=false;
      if(!errors.length&&window&&machine){
        const [prior]=await client.query<any[]>("SELECT contentHash,entityId FROM HistoricalImportCheckItem WHERE entity='MachineCheckup' AND recordKey=?",[recordKey]);
        if(prior){
          const [row]=await client.query<any[]>("SELECT status FROM MachineCheckup WHERE id=?",[prior.entityId]);
          if(prior.contentHash===contentHash&&row?.status!=="CANCELLED")duplicate=true;
          else errors.push(`Já existe uma verificação histórica diferente da máquina ${machine.code} neste turno.`);
        }else{
          const existing=await client.machineCheckup.count({where:{machineId:machine.id,observedAt:{gte:window.start,lt:window.end},status:{not:"CANCELLED"}}});
          if(existing)errors.push(`Já existe uma verificação da máquina ${machine.code} neste turno. Reveja para evitar duplicação.`);
        }
      }
      prepared.push({kind:"MACHINE",date,shift,operatorId:operator?.id,operatorName:operator?.name??operatorKey,machineId:machine?.id,machineCode:machine?.code??machineKey,start:window?.start,end:window?.end,normalized,recordKey,contentHash,source:sheet,errors,warnings,duplicate});
    }
  }

  return {
    items:prepared,
    hash:importHash(prepared.map(p=>({kind:p.kind,value:p.normalized,key:p.recordKey,duplicate:p.duplicate,errors:p.errors}))),
    errors:prepared.reduce((s,p)=>s+p.errors.length,0),
    newCount:prepared.filter(p=>!p.duplicate&&!p.errors.length).length,
    duplicateCount:prepared.filter(p=>p.duplicate).length,
  };
}
