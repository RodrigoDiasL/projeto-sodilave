"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getShift } from "@/lib/shift";
import { MachineEventType, MachineStatus, RecordStatus } from "@prisma/client";
import { changeMachineStatus } from "@/lib/machine-state";

export async function saveWeeklyShutdown(fd: FormData){
  const user=await requireUser();
  const finalize=String(fd.get("intent"))==="finalize";
  const id=Number(fd.get("shutdownId")||0);
  const startup=await db.weeklyStartup.findFirst({where:{status:RecordStatus.FINALIZED,shutdown:null},orderBy:{startupDate:"desc"}});
  if(!startup) throw new Error("Não existe um arranque semanal ativo para encerrar.");
  const runningMachines=await db.machine.findMany({where:{active:true,status:MachineStatus.RUNNING},orderBy:{code:"asc"}});
  if(!runningMachines.length) throw new Error("Não existem máquinas em funcionamento para parar.");

  const observations=String(fd.get("observations")||"").trim().slice(0,1500)||null;
  const data={operatorId:user.id,weeklyStartupId:startup.id,status:finalize?RecordStatus.FINALIZED:RecordStatus.DRAFT,shiftCode:getShift().code,
    cleanDispatch:fd.get("cleanDispatch")==="on",cleanStorage:fd.get("cleanStorage")==="on",cleanProduction:fd.get("cleanProduction")==="on",
    observations,finalizedAt:finalize?new Date():null};

  const fields=["externalCleaning","acrylicsCleaning","mouldCleaning","traysCleaning","catchersCleaning","beltsCleaning","packingTableCleaning","surroundingArea"];
  const machineRows=runningMachines.map(machine=>({
    machine,
    values:Object.fromEntries(fields.map(k=>[k,fd.get(`m${machine.id}_${k}`)==="on"])),
    notes:String(fd.get(`m${machine.id}_notes`)||"").trim().slice(0,500)||null,
  }));
  const incompleteGeneral=!data.cleanDispatch||!data.cleanStorage||!data.cleanProduction;
  const incompleteMachines=machineRows.some(row=>Object.values(row.values).some(v=>!v));
  if(finalize&&(incompleteGeneral||incompleteMachines)&&!observations) throw new Error("Pode finalizar com verificações por assinalar, mas deve explicar a situação nas observações gerais.");

  const existing=id?await db.weeklyShutdown.findUnique({where:{id}}):await db.weeklyShutdown.findUnique({where:{weeklyStartupId:startup.id}});
  if(existing?.status===RecordStatus.FINALIZED) throw new Error("Esta paragem já foi finalizada.");
  const row=existing?await db.weeklyShutdown.update({where:{id:existing.id},data}):await db.weeklyShutdown.create({data});
  await db.weeklyShutdownMachine.deleteMany({where:{weeklyShutdownId:row.id}});
  for(const machineRow of machineRows){
    await db.weeklyShutdownMachine.create({data:{weeklyShutdownId:row.id,machineId:machineRow.machine.id,...machineRow.values,notes:machineRow.notes}});
  }
  if(finalize) for(const machineRow of machineRows) await changeMachineStatus({machineId:machineRow.machine.id,toStatus:MachineStatus.STOPPED,type:MachineEventType.WEEKLY_SHUTDOWN,userId:user.id,reason:"Paragem semanal",occurredAt:row.shutdownDate});
  await db.auditLog.create({data:{userId:user.id,action:finalize?"FINALIZE":existing?"EDIT":"CREATE",entity:"WeeklyShutdown",entityId:String(row.id),details:{incompleteGeneral,incompleteMachines}}});
  revalidatePath("/shutdown");revalidatePath("/startup");revalidatePath("/dashboard");revalidatePath("/production");revalidatePath("/checkups");
  return {id:row.id,finalized:finalize};
}