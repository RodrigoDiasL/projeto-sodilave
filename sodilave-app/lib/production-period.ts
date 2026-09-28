import { createHmac, timingSafeEqual } from "node:crypto";
import { getShiftWindowForDate, formatLocalDateInput, type ShiftCode } from "@/lib/shift";
const sign=(value:string)=>createHmac("sha256",process.env.SESSION_SECRET!).update(value).digest("base64url");
export function issueProductionPeriod(userId:number,window:{start:Date;code:ShiftCode}){
  const value=Buffer.from(JSON.stringify({userId,date:formatLocalDateInput(window.start),code:window.code})).toString("base64url");
  return value+"."+sign(value);
}
export function readProductionPeriod(token:string,userId:number,now=new Date()){
  try{
    if(token.length>1024)throw new Error();
    const [value,signature]=token.split(".");const expected=Buffer.from(sign(value)),actual=Buffer.from(signature??"");
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new Error();
    const data=JSON.parse(Buffer.from(value,"base64url").toString());
    const window=getShiftWindowForDate(data.date,data.code);
    if(data.userId!==userId||window.start>now||now.getTime()>window.end.getTime()+48*3600000)throw new Error();
    return window;
  }catch{throw new Error("O turno deste formulário já não é válido. Abra o registo em Produções em aberto ou atualize a página.");}
}
