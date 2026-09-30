import type {DbTransaction} from "@/lib/db";
import {UserInputError} from "@/lib/action-error";
// Every incoming-stock path locks this same position, then uses a current read.
export async function assertPalletAvailable(tx:DbTransaction,locationId:number,productionId?:number){
  const [location]=await tx.query<any[]>("SELECT id,zoneType,code,warehouseName FROM StorageLocation WHERE id=? AND active=1 FOR UPDATE",[locationId]);
  if(!location)throw new UserInputError("A posição já não está disponível. Atualize o mapa.");
  if(location.zoneType!=="PALLET")return;
  const occupants=await tx.query<any[]>("SELECT productionId FROM ProductionStorageBalance WHERE locationId=? AND quantityPackages>0 FOR UPDATE",[locationId]);
  if(occupants.some(row=>Number(row.productionId)!==productionId))throw new UserInputError(`A posição de palete ${location.warehouseName} · ${location.code} está ocupada. Escolha uma posição livre; as estibas podem receber vários lotes.`);
}
