"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { MaintenanceStatus, MaintenanceType, MachineEventType, MachineStatus } from "@prisma/client";
import { changeMachineStatus } from "@/lib/machine-state";

export async function registerIntermediateStartup(fd:FormData){
 const user=await requireUser(); const machineId=Number(fd.get("machineId")); const reason=String(fd.get("reason")||"").trim(); const notes=String(fd.get("notes")||"").trim();
 if(!machineId||!reason)throw new Error("Selecione a máquina e indique o motivo.");
 const activeStartup=await db.weeklyStartup.findFirst({where:{status:"FINALIZED",shutdown:null},select:{id:true}});if(!activeStartup)throw new Error("É necessário existir um arranque semanal ativo.");
 const machine=await db.machine.findUniqueOrThrow({where:{id:machineId}}); if(machine.status===MachineStatus.RUNNING)throw new Error("A máquina já está em funcionamento.");
 let maintenanceId:number|undefined; if(fd.get("createCorrective")==="on"){
   const m=await db.maintenance.create({data:{type:MaintenanceType.CORRECTIVE,status:MaintenanceStatus.COMPLETED,performedAt:new Date(),completedAt:new Date(),observations:notes||reason,createdById:user.id,machines:{create:{machineId}},participants:{create:{userId:user.id}}}}); maintenanceId=m.id;
 }
 await changeMachineStatus({machineId,toStatus:MachineStatus.RUNNING,type:MachineEventType.INTERMEDIATE_STARTUP,userId:user.id,reason,notes,maintenanceId});
 await db.auditLog.create({data:{userId:user.id,action:"CREATE",entity:"IntermediateStartup",entityId:String(machineId),details:{reason,maintenanceId}}}); revalidatePath("/dashboard");revalidatePath("/machines");revalidatePath("/shutdown");revalidatePath("/production");revalidatePath("/checkups");
}