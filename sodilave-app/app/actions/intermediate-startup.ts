"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { MaintenanceStatus, MaintenanceType, MachineEventType, MachineStatus } from "@/lib/db-types";
import { changeMachineStatus } from "@/lib/machine-state";

export async function registerIntermediateStartup(fd:FormData){
 const user=await requireOperationalUser();
 const machineId=Number(fd.get("machineId"));
 const reason=String(fd.get("reason")||"").trim();
 const notes=String(fd.get("notes")||"").trim().slice(0,1500);
 if(!Number.isInteger(machineId)||machineId<=0||!reason)throw new Error("Selecione a máquina e indique o motivo.");

 await db.$transaction(async tx=>{
   const activeStartup=await tx.weeklyStartup.findFirst({where:{status:"FINALIZED",shutdown:null},select:{id:true}});
   if(!activeStartup)throw new Error("É necessário existir um arranque semanal ativo.");
   const machine=await tx.machine.findFirst({where:{id:machineId,active:true}});
   if(!machine)throw new Error("Máquina inválida.");
   if(machine.status===MachineStatus.RUNNING)throw new Error("A máquina já está em funcionamento.");

   let maintenanceId:number|undefined;
   if(fd.get("createCorrective")==="on"){
     const maintenance=await tx.maintenance.create({data:{type:MaintenanceType.CORRECTIVE,status:MaintenanceStatus.COMPLETED,performedAt:new Date(),completedAt:new Date(),observations:notes||reason.slice(0,1500),createdById:user.id,machines:{create:{machineId}},participants:{create:{userId:user.id}}}});
     maintenanceId=maintenance.id;
   }
   await changeMachineStatus({machineId,toStatus:MachineStatus.RUNNING,type:MachineEventType.INTERMEDIATE_STARTUP,userId:user.id,reason:reason.slice(0,500),notes,maintenanceId},tx);
   await tx.auditLog.create({data:{userId:user.id,action:"CREATE",entity:"IntermediateStartup",entityId:String(machineId),details:{reason:reason.slice(0,500),maintenanceId}}});
 });

 revalidatePath("/dashboard");revalidatePath("/machines");revalidatePath("/shutdown");revalidatePath("/production");revalidatePath("/checkups");
}
