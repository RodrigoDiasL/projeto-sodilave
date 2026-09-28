import { db, type DbTransaction } from "@/lib/db";
import { formatProductionLot } from "@/lib/lot-code";
export { formatProductionLot } from "@/lib/lot-code";
// The product determines the prefix. The machine contributes only the suffix.
export async function generateProductionLot(productId:number,machineCode:string,shiftCode:string,date=new Date(),client:DbTransaction=db){
  const [config]=await client.query<{majorLetter:string;minorLetter:string}[]>("SELECT majorLetter,minorLetter FROM ProductLotConfig WHERE productId=?",[productId]);
  return formatProductionLot(machineCode,shiftCode,date,config??{majorLetter:"A",minorLetter:"A"});
}
