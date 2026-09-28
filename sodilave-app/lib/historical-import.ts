import { createHash } from "node:crypto";
import { db, type DbTransaction } from "@/lib/db";
import { parseHistoricalImport } from "@/lib/historical-import-format";
import { getShiftWindowForDate, type ShiftCode } from "@/lib/shift";
export const importHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type ImportMapping={products:Record<string,number>;operators:Record<string,number>;machines:Record<string,number>};
export async function prepareHistoricalImport(content:string,mapping:ImportMapping,client:DbTransaction=db){
  const rows=parseHistoricalImport(content);
  const [products,users,machines,lots]=await Promise.all([client.product.findMany(),client.user.findMany({select:{id:true,name:true}}),client.machine.findMany(),client.rawMaterialLot.findMany({select:{id:true}})]);
  const seen=new Set<string>();const prepared=[];
  for(const row of rows){
    const errors:string[]=[],warnings:string[]=[];
    let window;try{window=getShiftWindowForDate(row.date,row.shift as ShiftCode);if(window.end>new Date())errors.push('Só é possível importar turnos já terminados.');}catch{errors.push('Data inválida.');}
    const product=products.find(p=>p.id===Number(mapping.products?.[row.productKey]??row.productId));
    const operator=users.find(u=>u.id===Number(mapping.operators?.[row.operatorKey]??row.operatorId));
    const machine=machines.find(m=>m.id===Number(mapping.machines?.[row.machineKey]??row.machineId))??(!mapping.machines?.[row.machineKey]?machines.find(m=>String(m.code)===row.machineKey.replace(/^M(?:AQ(?:UINA)?)?\s*/i,'')):undefined);
    if(!product)errors.push('Associe o produto do ficheiro a um artigo da aplicação.');if(!operator)errors.push('Identifique o operador desta folha.');if(!machine)errors.push('Associe a máquina.');
    const units=row.unit==='UNIT'?1:row.unitsPerPackage??Number(product?.unitsPerPackage);
    if(!Number.isSafeInteger(units)||units<1)errors.push('Indique as unidades por embalagem.');
    if(product&&row.unit!==product.productionUnit&&row.unitsPerPackage===null)errors.push('A unidade antiga difere da atual: preencha unidades_por_embalagem no ficheiro.');
    if(row.unitsPerPackage===null&&row.unit!=='UNIT')warnings.push('Unidades por embalagem retiradas do catálogo atual: confirme na pré-visualização.');
    if(!row.lotCode)warnings.push('Sem lote antigo: será atribuída uma referência de arquivo HIST, sem inventar um lote comercial.');
    if(!row.initialWeightG||!row.midWeightG)warnings.push('Peso(s) não registado(s).');
    const materials=[];for(const material of row.materials){const id=Number(material.rawMaterialLotId);if(!id){warnings.push('MP descrita no ficheiro sem lote associado: texto original conservado.');continue;}if(!lots.some(l=>l.id===id)){errors.push(`Lote de MP #${id} inexistente.`);continue;}const pct=material.percentage==null?null:Number(material.percentage),kg=material.quantityKg==null?null:Number(material.quantityKg);if((pct!==null&&(!Number.isFinite(pct)||pct<0||pct>100))||(kg!==null&&(!Number.isFinite(kg)||kg<0||kg>10000000)))errors.push('Percentagem ou quantidade de MP inválida.');materials.push({rawMaterialLotId:id,percentage:pct,quantityKg:kg});}
    if(new Set(materials.map(m=>m.rawMaterialLotId)).size!==materials.length)errors.push('Lote de MP repetido na mistura.');
    const key=importHash([row.date,row.shift,machine?.id,product?.id]);
    if(seen.has(key))errors.push('Produção repetida no ficheiro (data, turno, máquina e produto).');seen.add(key);
    const code=row.lotCode||`HIST-${row.date}-${row.shift}-M${machine?.code??row.machineKey}-P${product?.id??0}`;
    const normalized={date:row.date,shift:row.shift,machineId:machine?.id,productId:product?.id,operatorId:operator?.id,code,quantity:row.quantity,unit:row.unit,units,initialWeightG:row.initialWeightG,midWeightG:row.midWeightG,tests:row.tests,materials,notes:row.notes};
    const contentHash=importHash(normalized);let duplicate=false;
    if(!errors.length&&window){
      const [prior]=await client.query<any[]>('SELECT i.contentHash,p.status FROM HistoricalImportItem i JOIN Production p ON p.id=i.productionId WHERE i.recordKey=?',[key]);
      if(prior){if(prior.contentHash===contentHash&&prior.status!=='CANCELLED')duplicate=true;else errors.push('Já existe uma importação diferente ou cancelada para este produto, máquina e turno. Não será sobrescrita.');}
      else if(await client.production.count({where:{machineId:machine.id,productId:product.id,recordOrigin:{not:'INITIAL_STOCK'},status:{not:'CANCELLED'},startedAt:{gte:window.start,lt:window.end}}}))errors.push('Já existe produção deste artigo nesta máquina e turno. Reveja para evitar duplicação.');
    }
    prepared.push({row,normalized,recordKey:key,contentHash,start:window?.start,end:window?.end,productName:product?.name??row.productKey,operatorName:operator?.name??row.operatorKey,machineCode:machine?.code??row.machineKey,errors,warnings,duplicate});
  }
  return {items:prepared,hash:importHash(prepared.map(p=>({value:p.normalized,key:p.recordKey,duplicate:p.duplicate,errors:p.errors}))),errors:prepared.reduce((s,p)=>s+p.errors.length,0),newCount:prepared.filter(p=>!p.duplicate&&!p.errors.length).length,duplicateCount:prepared.filter(p=>p.duplicate).length};
}
