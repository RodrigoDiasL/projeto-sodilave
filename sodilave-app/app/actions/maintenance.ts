"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireProductionManager } from "@/lib/auth";
import { MaintenanceStatus, MaintenanceType, MachineEventType, MachineStatus } from "@/lib/db-types";
import { changeMachineStatus } from "@/lib/machine-state";

const ids=(fd:FormData,key:string)=>[...new Set(fd.getAll(key).map(Number).filter(x=>Number.isInteger(x)&&x>0))];
const date=(v:FormDataEntryValue|null)=>{const d=new Date(String(v||""));if(Number.isNaN(d.getTime()))throw new Error("Data inválida.");return d};

export async function createMaintenance(fd:FormData):Promise<void>{
 const user=await requireProductionManager();
 const type=String(fd.get("type")) as MaintenanceType;
 if(!Object.values(MaintenanceType).includes(type))throw new Error("Tipo de manutenção inválido.");
 const machineIds=ids(fd,"machineIds"), participantIds=ids(fd,"participantIds");
 if(!machineIds.length)throw new Error("Selecione pelo menos uma máquina.");
 const observations=String(fd.get("observations")||"").trim();
 if(!observations)throw new Error("Descreva a intervenção.");
 const performedAt=date(fd.get("performedAt"));

 await db.$transaction(async tx=>{
   const validMachines=await tx.machine.count({where:{id:{in:machineIds},active:true}});
   if(validMachines!==machineIds.length)throw new Error("Uma das máquinas selecionadas já não está disponível.");
   if(participantIds.length){
     const validUsers=await tx.user.count({where:{id:{in:participantIds},active:true}});
     if(validUsers!==participantIds.length)throw new Error("Um dos funcionários selecionados já não está ativo.");
   }
   const row=await tx.maintenance.create({data:{type,status:MaintenanceStatus.OPEN,performedAt,observations:observations.slice(0,3000),createdById:user.id,machines:{create:machineIds.map(machineId=>({machineId}))},participants:{create:participantIds.map(userId=>({userId}))}}});
   await tx.auditLog.create({data:{userId:user.id,action:"CREATE",entity:"Maintenance",entityId:String(row.id),details:{machineIds,participantIds,type}}});
 });
 revalidatePath("/maintenance");
}

export async function completeMaintenance(fd:FormData):Promise<void>{
 const user=await requireProductionManager();
 const id=Number(fd.get("id"));
 if(!Number.isInteger(id)||id<=0)throw new Error("Manutenção inválida.");

 await db.$transaction(async tx=>{
   const updated=await tx.maintenance.updateMany({where:{id,status:MaintenanceStatus.OPEN},data:{status:MaintenanceStatus.COMPLETED,completedAt:new Date()}});
   if(updated.count!==1)throw new Error("Esta manutenção já não está em aberto ou não existe.");
   const row=await tx.maintenance.findUniqueOrThrow({where:{id},include:{machines:true}});
   for(const m of row.machines)await changeMachineStatus({machineId:m.machineId,toStatus:MachineStatus.STOPPED,type:MachineEventType.MAINTENANCE_END,userId:user.id,maintenanceId:id,reason:"Manutenção concluída; aguarda arranque intermédio"},tx);
   await tx.auditLog.create({data:{userId:user.id,action:"FINALIZE",entity:"Maintenance",entityId:String(id)}});
 });
 revalidatePath("/maintenance");revalidatePath("/dashboard");revalidatePath("/machines");
}
