export type LotPrefix = { majorLetter:string; minorLetter:string };
export const generatedLotPattern=/^[A-Z]{2}[ABC][0-6][0-9]{4}m.+$/;
function isoWeek(date:Date){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d.getTime()-yearStart.getTime())/86400000)+1)/7);
}
export function formatProductionLot(machineCode:string,shiftCode:string,date:Date,config:LotPrefix={majorLetter:"A",minorLetter:"A"}){
  return `${config.majorLetter}${config.minorLetter}${shiftCode}${date.getDay()}${String(isoWeek(date)).padStart(2,"0")}${String(date.getFullYear()).slice(-2)}m${machineCode}`;
}
