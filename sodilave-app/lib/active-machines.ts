import { db } from "@/lib/db";

export async function getActiveWeeklyStartup() {
  return db.weeklyStartup.findFirst({where:{status:"FINALIZED",shutdown:null},orderBy:[{startupDate:"desc"},{id:"desc"}],include:{machines:{select:{machineId:true}}}});
}
export async function getActiveWeeklyMachineIds(){const startup=await getActiveWeeklyStartup();if(!startup)return[];const rows=await db.machine.findMany({where:{active:true,status:"RUNNING"},select:{id:true}});return rows.map(r=>r.id)}
export async function getActiveWeeklyMachines(){const startup=await getActiveWeeklyStartup();if(!startup)return[];return db.machine.findMany({where:{active:true,status:"RUNNING"},orderBy:{code:"asc"}})}
export async function assertMachineRunning(machineId:number){const startup=await getActiveWeeklyStartup();if(!startup)throw new Error("Não existe um arranque semanal ativo.");const machine=await db.machine.findUnique({where:{id:machineId}});if(!machine||machine.status!=="RUNNING")throw new Error("A máquina selecionada está parada.")}
