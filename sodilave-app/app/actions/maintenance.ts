"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireProductionManager } from "@/lib/auth";
import { MaintenanceStatus, MaintenanceType, MachineEventType, MachineStatus } from "@prisma/client";
import { changeMachineStatus } from "@/lib/machine-state";

const ids=(fd:FormData,key:string)=>fd.getAll(key).map(Number).filter(x=>Number.isInteger(x)&&x>0);
const date=(v:FormDataEntryValue|null)=>{const d=new Date(String(v||""));if(Number.isNaN(d.getTime()))throw new Error("Data inválida.");return d};
export async function createMaintenance(fd:FormData){
 const user=await requireProductionManager(); const type=String(fd.get("type")) as MaintenanceType;
 if(!Object.values(MaintenanceType).includes(type))throw new Error("Tipo de manutenção inválido.");
 const machineIds=ids(fd,"machineIds"), participantIds=ids(fd,"participantIds"); if(!machineIds.length)throw new Error("Selecione pelo menos uma máquina.");
 const observations=String(fd.get("observations")||"").trim(); if(!observations)throw new Error("Descreva a intervenção.");
 const row=await db.maintenance.create({data:{type,status:MaintenanceStatus.OPEN,performedAt:date(fd.get("performedAt")),observations,createdById:user.id,machines:{create:machineIds.map(machineId=>({machineId}))},participants:{create:participantIds.map(userId=>({userId}))}}});
 await db.auditLog.create({data:{userId:user.id,action:"CREATE",entity:"Maintenance",entityId:String(row.id)}}); revalidatePath("/maintenance"); return row.id;
}
export async function completeMaintenance(fd:FormData){
 const user=await requireProductionManager(); const id=Number(fd.get("id")); const row=await db.maintenance.update({where:{id},data:{status:MaintenanceStatus.COMPLETED,completedAt:new Date()},include:{machines:true}});
 for(const m of row.machines) await changeMachineStatus({machineId:m.machineId,toStatus:MachineStatus.STOPPED,type:MachineEventType.MAINTENANCE_END,userId:user.id,maintenanceId:id,reason:"Manutenção concluída; aguarda arranque intermédio"});
 await db.auditLog.create({data:{userId:user.id,action:"FINALIZE",entity:"Maintenance",entityId:String(id)}}); revalidatePath("/maintenance");
}
