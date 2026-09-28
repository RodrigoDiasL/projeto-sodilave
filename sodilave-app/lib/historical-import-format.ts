export type ImportRow={index:number;date:string;shift:string;machineKey:string;machineId?:number;productKey:string;productId?:number;operatorKey:string;operatorId?:number;lotCode:string;quantity:number;unit:string;unitsPerPackage:number|null;initialWeightG:number|null;midWeightG:number|null;tests:Record<string,string>;materials:any[];notes:string;source:any};
const value=(v:any)=>String(v??"").trim();
function number(v:any,label:string,optional=false){if(v===null||v===undefined||v===""){if(optional)return null;throw new Error(`${label}: falta um valor.`);}const n=Number(String(v).replace(',','.'));if(!Number.isFinite(n)||n<0||n>10000000)throw new Error(`${label}: valor inválido.`);return n;}
function csv(text:string){
  const delimiter=text.split(/\r?\n/,1)[0].includes(';')?';':',';
  const lines:string[][]=[];let row:string[]=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(field);field='';}else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));if(row.some(v=>v.trim()))lines.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new Error('CSV com aspas por fechar.');row.push(field.replace(/\r$/,''));if(row.some(v=>v.trim()))lines.push(row);
  const keys=lines.shift()?.map(s=>s.trim())??[];if(new Set(keys).size!==keys.length)throw new Error('CSV com colunas repetidas.');
  return lines.map((values,i)=>{if(values.length!==keys.length)throw new Error(`CSV: número de colunas inválido na linha ${i+2}.`);return Object.fromEntries(keys.map((k,j)=>[k,values[j]]));});
}
export function parseHistoricalImport(text:string):ImportRow[]{
  if(new TextEncoder().encode(text).length>1000000)throw new Error('O ficheiro pode ter até 1 MB (500 produções por importação).');
  text=text.replace(/^\uFEFF/,'').trim();if(!text)throw new Error('O ficheiro está vazio.');
  let documents:any[];
  if(text[0]==='{'||text[0]==='['){let data:any;try{data=JSON.parse(text);}catch{throw new Error('O ficheiro JSON não é válido.');}if(data.schemaVersion!==undefined&&data.schemaVersion!==1)throw new Error('Versão de importação não suportada. Use schemaVersion 1.');documents=Array.isArray(data)?data:Array.isArray(data.sheets)?data.sheets:Array.isArray(data.records)?data.records:[data];}
  else documents=csv(text);
  const expanded=documents.flatMap(d=>Array.isArray(d.productions)?d.productions.map((p:any)=>({...p,shiftDate:d.shift?.date,shiftCode:d.shift?.code,operator:d.shift?.workers?.[0],sourceSheet:d})): [d]);
  if(!expanded.length||expanded.length>500)throw new Error('Escolha um ficheiro com 1 a 500 produções. Um manifesto de imagens ainda precisa de ser convertido em dados.');
  return expanded.map((p:any,i)=>{
    const line=`Linha ${i+1}`,quantity=number(p.quantityProduced??p.quantidade,line+' — quantidade')!;
    if(!Number.isSafeInteger(quantity))throw new Error(line+' — a quantidade de embalagens tem de ser inteira.');
    const units=number(p.unitsPerPackage??p.unidades_por_embalagem,line+' — unidades por embalagem',true);if(units!==null&&(!Number.isSafeInteger(units)||units<1))throw new Error(line+' — unidades por embalagem inválidas.');
    const tests:Record<string,string>={};for(const key of ['leakStart','leakMid','dropStart','dropMid']){const raw=value(p.tests?.[key]??p[key]);const v=({conforme:'CONFORMING','não conforme':'NON_CONFORMING','não realizado':'NOT_PERFORMED'} as Record<string,string>)[raw.toLowerCase()]??raw.toUpperCase();if(v&&!['CONFORMING','NON_CONFORMING','NOT_PERFORMED'].includes(v))throw new Error(line+' — teste inválido: '+key);tests[key]=v||'NOT_PERFORMED';}
    const date=value(p.shiftDate??p.date??p.data),shift=value(p.shiftCode??p.shift??p.turno).toUpperCase();
    const machineKey=value(p.machineCode??p.maquina??p.machineId),productId=Number(p.product?.productId??p.productId)||undefined,operatorId=Number(p.operator?.userId??p.operatorId)||undefined;
    const productKey=value(p.product?.rawText??p.productCode??p.produto)||(productId?`ID ${productId}`:`Produto por identificar (linha ${i+1})`);
    const operatorKey=value(p.operator?.rawText??p.operatorName??p.operador)||(operatorId?`ID ${operatorId}`:'Operador não identificado');
    const unit=value(p.productionUnit??p.unidade).toUpperCase()||'BAG';if(!['BAG','UNIT','PALLET'].includes(unit))throw new Error(line+' — unidade inválida: BAG, UNIT ou PALLET.');
    const lotCode=value(p.productionLot??p.lotCode??p.lote);if(lotCode.length>120)throw new Error(line+' — lote demasiado longo.');
    if(!machineKey||!date||!['A','B','C'].includes(shift))throw new Error(line+' — indique data, turno A/B/C e máquina.');
    return {index:i+1,date,shift,machineKey,machineId:Number(p.machineId)||undefined,productKey,productId,operatorKey,operatorId,lotCode,quantity,unit,unitsPerPackage:units,initialWeightG:number(p.initialWeightG??p.peso_inicio_g,line+' — peso inicial',true),midWeightG:number(p.midWeightG??p.peso_meio_g,line+' — peso intermédio',true),tests,materials:Array.isArray(p.materials)?p.materials:[],notes:[value(p.observations??p.observacoes),value(p.sourceSheet?.paperObservations)].filter(Boolean).join('\n').slice(0,10000),source:p.sourceSheet?{...p.sourceSheet,productions:[{...p,sourceSheet:undefined}]}:p};
  });
}
export const historicalCsvTemplate='data;turno;maquina;produto;operador;lote;quantidade;unidade;unidades_por_embalagem;peso_inicio_g;peso_meio_g;leakStart;leakMid;dropStart;dropMid;observacoes\n2026-09-01;B;2;Nome do produto;Nome do operador;LOTE-ANTIGO;50;BAG;32;165;165;CONFORMING;NOT_PERFORMED;CONFORMING;NOT_PERFORMED;Folha antiga\n';
