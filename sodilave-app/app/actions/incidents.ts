"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { IncidentType, MachineEventType, MachineStatus } from "@/lib/db-types";
import { changeMachineStatus } from "@/lib/machine-state";

export async function registerIncident(fd:FormData){
 const user=await requireOperationalUser();
 const machineId=Number(fd.get("machineId"));
 const type=String(fd.get("type")||"BREAKDOWN") as IncidentType;
 const description=String(fd.get("description")||"").trim();
 const stoppedMachine=fd.get("stoppedMachine")==="on";
 const occurredAtRaw=String(fd.get("occurredAt")||"");
 const occurredAt=occurredAtRaw?new Date(occurredAtRaw):new Date();
 if(!Number.isInteger(machineId)||machineId<=0||!description)throw new Error("Selecione a máquina e descreva a ocorrência.");
 if(!Object.values(IncidentType).includes(type))throw new Error("Tipo de ocorrência inválido.");
 if(Number.isNaN(occurredAt.getTime()))throw new Error("A data e hora da ocorrência são inválidas.");

 await db.$transaction(async tx=>{
   const machines=await tx.query<{id:number;status:MachineStatus}[]>(
     "SELECT id,status FROM Machine WHERE id=? AND active=1 FOR UPDATE",
     [machineId],
   );
   const machine=machines[0];
   if(!machine)throw new Error("Máquina inválida.");
   const startup=await tx.weeklyStartup.findFirst({where:{status:"FINALIZED",shutdown:null}});
   if(!startup)throw new Error("Não existe um arranque semanal ativo.");
   if(occurredAt>new Date()||occurredAt<(startup.finalizedAt??startup.startupDate))throw new Error("A ocorrência deve pertencer ao ciclo semanal atual e não pode estar no futuro.");
   if(stoppedMachine&&machine.status===MachineStatus.STOPPED)throw new Error("A máquina já está parada. Atualize o estado antes de registar a paragem.");
   const incident=await tx.incident.create({data:{machineId,type,occurredAt,description:description.slice(0,2000),stoppedMachine,createdById:user.id}});
   if(stoppedMachine&&machine.status!==MachineStatus.STOPPED)await changeMachineStatus({machineId,toStatus:MachineStatus.STOPPED,type:MachineEventType.BREAKDOWN_STOP,userId:user.id,reason:type==="BREAKDOWN"?"Avaria registada":"Paragem registada",notes:description,incidentId:incident.id,occurredAt},tx);
   await tx.auditLog.create({data:{userId:user.id,action:"CREATE",entity:"Incident",entityId:String(incident.id),details:{machineId,type,stoppedMachine}}});
 });

 revalidatePath("/dashboard");revalidatePath("/machines");revalidatePath("/shutdown");revalidatePath("/production");revalidatePath("/checkups");
}
