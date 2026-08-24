import { db } from "@/lib/db";
import { MachineEventType, MachineStatus, Prisma } from "@prisma/client";

type ChangeMachineStatusArgs={machineId:number;toStatus:MachineStatus;type:MachineEventType;userId:number;reason?:string|null;notes?:string|null;maintenanceId?:number|null;incidentId?:number|null;occurredAt?:Date};

async function applyMachineStatus(tx:Prisma.TransactionClient,{machineId,toStatus,type,userId,reason,notes,maintenanceId,incidentId,occurredAt=new Date()}:ChangeMachineStatusArgs){
  const rows=await tx.$queryRaw<{id:number;status:MachineStatus}[]>(Prisma.sql`
    SELECT id,status FROM Machine WHERE id=${machineId} FOR UPDATE
  `);
  const machine=rows[0];
  if(!machine)throw new Error("A máquina já não existe.");
  await tx.machine.update({where:{id:machineId},data:{status:toStatus,statusChangedAt:occurredAt}});
  return tx.machineEvent.create({data:{machineId,type,fromStatus:machine.status,toStatus,occurredAt,reason:reason||null,notes:notes||null,createdById:userId,maintenanceId:maintenanceId||null,incidentId:incidentId||null}});
}

export async function changeMachineStatus(args:ChangeMachineStatusArgs,client?:Prisma.TransactionClient){
  if(client)return applyMachineStatus(client,args);
  return db.$transaction(tx=>applyMachineStatus(tx,args));
}

export function calculateUptime(events:{occurredAt:Date;toStatus:MachineStatus}[], from:Date, to=new Date()){
  let running=false; let cursor=from; let ms=0;
  for(const e of events.filter(e=>e.occurredAt>=from&&e.occurredAt<=to).sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime())){
    if(running) ms += e.occurredAt.getTime()-cursor.getTime();
    running=e.toStatus===MachineStatus.RUNNING; cursor=e.occurredAt;
  }
  if(running) ms += to.getTime()-cursor.getTime();
  const total=Math.max(1,to.getTime()-from.getTime());
  return {hours:ms/3600000,percentage:Math.round(ms/total*100)};
}
