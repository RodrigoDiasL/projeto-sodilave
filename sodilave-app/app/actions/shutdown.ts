"use server";
import { revalidatePath } from "next/cache";
import { getWeeklyShutdownMachines } from "@/lib/active-machines";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { getShift } from "@/lib/shift";
import { MachineEventType, MachineStatus, RecordStatus } from "@/lib/db-types";
import { changeMachineStatus } from "@/lib/machine-state";

export async function saveWeeklyShutdown(fd: FormData){
  const user=await requireOperationalUser();
  const intent=String(fd.get("intent")||"draft");
  if(!["draft","finalize"].includes(intent))throw new Error("Ação inválida.");
  const finalize=intent==="finalize";
  const id=Number(fd.get("shutdownId")||0);
  if(id&&(!Number.isInteger(id)||id<=0))throw new Error("Paragem semanal inválida.");
  const observations=String(fd.get("observations")||"").trim().slice(0,1500)||null;
  const shiftCode=getShift().code;
  const fields=["externalCleaning","acrylicsCleaning","mouldCleaning","traysCleaning","catchersCleaning","beltsCleaning","packingTableCleaning","surroundingArea"];

  const row=await db.$transaction(async tx=>{
    await tx.query("SELECT id FROM Machine ORDER BY id FOR UPDATE");
    const startup=await tx.weeklyStartup.findFirst({where:{status:RecordStatus.FINALIZED,shutdown:null},orderBy:{startupDate:"desc"}});
    if(!startup)throw new Error("Não existe um arranque semanal ativo para encerrar.");

    const runningMachines=await getWeeklyShutdownMachines(startup.id,tx);


    const machineRows=runningMachines.map(machine=>({
      machine,
      values:Object.fromEntries(fields.map(k=>[k,fd.get(`m${machine.id}_${k}`)==="on"])),
      notes:String(fd.get(`m${machine.id}_notes`)||"").trim().slice(0,500)||null,
    }));
    const incompleteGeneral=fd.get("cleanDispatch")!=="on"||fd.get("cleanStorage")!=="on"||fd.get("cleanProduction")!=="on";
    const incompleteMachines=machineRows.some(item=>Object.values(item.values).some(v=>!v));
    if(finalize&&(incompleteGeneral||incompleteMachines)&&!observations)throw new Error("Pode finalizar com verificações por assinalar, mas deve explicar a situação nas observações gerais.");

    const existing=id?await tx.weeklyShutdown.findUnique({where:{id}}):await tx.weeklyShutdown.findUnique({where:{weeklyStartupId:startup.id}});
    if(id&&!existing)throw new Error("Esta paragem semanal já não existe.");
    if(existing&&existing.weeklyStartupId!==startup.id)throw new Error("Esta paragem não pertence ao ciclo semanal atualmente ativo.");
    if(existing?.status===RecordStatus.CANCELLED)throw new Error("Esta paragem foi cancelada.");
    if(existing?.status===RecordStatus.FINALIZED)throw new Error("Esta paragem já foi finalizada.");

    const data={weeklyStartupId:startup.id,status:finalize?RecordStatus.FINALIZED:RecordStatus.DRAFT,shiftCode,
      cleanDispatch:fd.get("cleanDispatch")==="on",cleanStorage:fd.get("cleanStorage")==="on",cleanProduction:fd.get("cleanProduction")==="on",
      observations,finalizedAt:finalize?new Date():null};

    const saved=existing
      ? await tx.weeklyShutdown.update({where:{id:existing.id},data})
      : await tx.weeklyShutdown.create({data:{...data,operatorId:user.id}});

    await tx.weeklyShutdownMachine.deleteMany({where:{weeklyShutdownId:saved.id}});
    for(const machineRow of machineRows){
      await tx.weeklyShutdownMachine.create({data:{weeklyShutdownId:saved.id,machineId:machineRow.machine.id,...machineRow.values,notes:machineRow.notes}});
    }

    if(finalize){
      for(const machineRow of machineRows.filter(row=>row.machine.status===MachineStatus.RUNNING))await changeMachineStatus({machineId:machineRow.machine.id,toStatus:MachineStatus.STOPPED,type:MachineEventType.WEEKLY_SHUTDOWN,userId:user.id,reason:"Paragem semanal",occurredAt:data.finalizedAt!},tx);
    }
    await tx.auditLog.create({data:{userId:user.id,action:finalize?"FINALIZE":existing?"EDIT":"CREATE",entity:"WeeklyShutdown",entityId:String(saved.id),details:{incompleteGeneral,incompleteMachines,machineIds:runningMachines.map(m=>m.id)}}});
    return saved;
  });

  revalidatePath("/shutdown");revalidatePath("/startup");revalidatePath("/dashboard");revalidatePath("/production");revalidatePath("/checkups");revalidatePath("/machines");
  return {id:row.id,finalized:finalize};
}
