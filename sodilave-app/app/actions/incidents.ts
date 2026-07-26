"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { IncidentType, MachineEventType, MachineStatus } from "@prisma/client";
import { changeMachineStatus } from "@/lib/machine-state";
import { getActiveWeeklyStartup } from "@/lib/active-machines";

export async function registerIncident(fd:FormData){
 const user=await requireOperationalUser();
 const startup=await getActiveWeeklyStartup();
 if(!startup)throw new Error("Não existe um arranque semanal ativo.");
 const machineId=Number(fd.get("machineId"));
 const type=String(fd.get("type")||"BREAKDOWN") as IncidentType;
 const description=String(fd.get("description")||"").trim();
 const stoppedMachine=fd.get("stoppedMachine")==="on";
 const occurredAtRaw=String(fd.get("occurredAt")||"");
 const occurredAt=occurredAtRaw?new Date(occurredAtRaw):new Date();
 if(!machineId||!description)throw new Error("Selecione a máquina e descreva a ocorrência.");
 if(!Object.values(IncidentType).includes(type))throw new Error("Tipo de ocorrência inválido.");
 if(Number.isNaN(occurredAt.getTime()))throw new Error("A data e hora da ocorrência são inválidas.");
 const machine=await db.machine.findFirst({where:{id:machineId,active:true}});if(!machine)throw new Error("Máquina inválida.");
 const incident=await db.incident.create({data:{machineId,type,occurredAt,description:description.slice(0,2000),stoppedMachine,createdById:user.id}});
 if(stoppedMachine&&machine.status!==MachineStatus.STOPPED)await changeMachineStatus({machineId,toStatus:MachineStatus.STOPPED,type:MachineEventType.BREAKDOWN_STOP,userId:user.id,reason:type==="BREAKDOWN"?"Avaria registada":"Paragem registada",notes:description,incidentId:incident.id,occurredAt});
 await db.auditLog.create({data:{userId:user.id,action:"CREATE",entity:"Incident",entityId:String(incident.id),details:{machineId,type,stoppedMachine}}});
 revalidatePath("/dashboard");revalidatePath("/machines");revalidatePath("/shutdown");revalidatePath("/production");revalidatePath("/checkups");
}
