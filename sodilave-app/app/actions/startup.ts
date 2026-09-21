"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { getShift } from "@/lib/shift";
import { MachineEventType, MachineStatus, RecordStatus, TestResult } from "@/lib/db-types";
import { changeMachineStatus } from "@/lib/machine-state";

const result = (fd: FormData, key: string) => {
  const value = String(fd.get(key) || "");
  return Object.values(TestResult).includes(value as TestResult) ? value as TestResult : null;
};

export async function saveWeeklyStartup(fd: FormData) {
  const user = await requireOperationalUser();
  const intent = String(fd.get("intent") || "draft");
  if(!["draft","finalize"].includes(intent)) throw new Error("Ação inválida.");
  const finalize = intent === "finalize";
  const idValue = Number(fd.get("startupId") || 0);
  if(idValue && (!Number.isInteger(idValue)||idValue<=0)) throw new Error("Arranque semanal inválido.");
  const machineIds = [...new Set(fd.getAll("machineIds").map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (finalize && !machineIds.length) throw new Error("Selecione pelo menos uma máquina para finalizar o arranque semanal.");
  const requiredGeneral = ["productionWindows", "storageWindows", "dispatchWindows", "forkliftIntegrity", "emergencyLighting"];
  if (finalize && requiredGeneral.some((key) => !result(fd, key))) throw new Error("Complete todas as verificações gerais antes de finalizar.");

  const machineChecks=machineIds.map(machineId=>{
    const prefix=`m${machineId}_`;
    const checks={
      acrylics:result(fd,prefix+"acrylics"),
      plasticTrays:result(fd,prefix+"plasticTrays"),
      lighting:result(fd,prefix+"lighting"),
      extruderTemperatures:result(fd,prefix+"extruderTemperatures"),
      lubrication:result(fd,prefix+"lubrication"),
      mouldCleaning:result(fd,prefix+"mouldCleaning"),
      beltsTraysTables:result(fd,prefix+"beltsTraysTables"),
      waterFilters:result(fd,prefix+"waterFilters"),
    };
    if(finalize&&Object.values(checks).some(v=>!v)) throw new Error(`Complete as verificações da máquina ${machineId}.`);
    return {machineId,checks};
  });

  const shiftCode=getShift().code;
  const data={
    status:finalize?RecordStatus.FINALIZED:RecordStatus.DRAFT,
    shiftCode,
    chillerSmall:fd.get("chillerSmall")==="on",
    chillerLarge:fd.get("chillerLarge")==="on",
    coolingPump:fd.get("coolingPump")==="on",
    compressor:fd.get("compressor")==="on",
    airDryers:fd.get("airDryers")==="on",
    airDemolecularizer:fd.get("airDemolecularizer")==="on",
    productionWindows:result(fd,"productionWindows"),
    storageWindows:result(fd,"storageWindows"),
    dispatchWindows:result(fd,"dispatchWindows"),
    forkliftIntegrity:result(fd,"forkliftIntegrity"),
    emergencyLighting:result(fd,"emergencyLighting"),
    observations:String(fd.get("observations")||"").trim().slice(0,1500)||null,
    finalizedAt:finalize?new Date():null,
  };

  const startup=await db.$transaction(async tx=>{
    const existing=idValue?await tx.weeklyStartup.findUnique({where:{id:idValue}}):null;
    if(idValue&&!existing) throw new Error("Este arranque semanal já não existe.");
    if(existing?.status===RecordStatus.CANCELLED) throw new Error("Este arranque foi cancelado.");
    if(existing?.status===RecordStatus.FINALIZED) throw new Error("Este arranque já foi finalizado.");

    if(!existing){
      const lastStartup=await tx.weeklyStartup.findFirst({where:{status:RecordStatus.FINALIZED},orderBy:{startupDate:"desc"},include:{shutdown:true}});
      if(lastStartup&&!lastStartup.shutdown) throw new Error("Antes de iniciar uma nova semana, finalize a paragem semanal do arranque anterior.");
    }

    if(machineIds.length){
      const validMachines=await tx.machine.count({where:{id:{in:machineIds},active:true}});
      if(validMachines!==machineIds.length) throw new Error("Uma das máquinas selecionadas já não está ativa.");
    }

    const saved=existing
      ? await tx.weeklyStartup.update({where:{id:existing.id},data})
      : await tx.weeklyStartup.create({data:{...data,operatorId:user.id}});

    await tx.weeklyStartupMachine.deleteMany({where:{weeklyStartupId:saved.id}});
    for(const row of machineChecks) await tx.weeklyStartupMachine.create({data:{weeklyStartupId:saved.id,machineId:row.machineId,...row.checks}});

    if(finalize){
      for(const machineId of machineIds) await changeMachineStatus({machineId,toStatus:MachineStatus.RUNNING,type:MachineEventType.WEEKLY_STARTUP,userId:user.id,reason:"Arranque semanal",occurredAt:saved.startupDate},tx);
    }
    await tx.auditLog.create({data:{userId:user.id,action:finalize?"FINALIZE":existing?"EDIT":"CREATE",entity:"WeeklyStartup",entityId:String(saved.id),details:{machineIds}}});
    return saved;
  });

  revalidatePath("/startup"); revalidatePath("/dashboard"); revalidatePath("/production"); revalidatePath("/checkups"); revalidatePath("/machines");
  return { id: startup.id, finalized: finalize };
}
