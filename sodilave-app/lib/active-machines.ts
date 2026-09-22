import { db } from "@/lib/db";

export async function getActiveWeeklyStartup() {
  return db.weeklyStartup.findFirst({where:{status:"FINALIZED",shutdown:null},orderBy:[{startupDate:"desc"},{id:"desc"}],include:{machines:{select:{machineId:true}}}});
}
export async function getActiveWeeklyMachineIds(){const startup=await getActiveWeeklyStartup();if(!startup)return[];const rows=await db.machine.findMany({where:{active:true,status:"RUNNING"},select:{id:true}});return rows.map(r=>r.id)}
export async function getActiveWeeklyMachines(){const startup=await getActiveWeeklyStartup();if(!startup)return[];return db.machine.findMany({where:{active:true,status:"RUNNING"},orderBy:{code:"asc"}})}
export async function assertMachineRunning(machineId:number){const startup=await getActiveWeeklyStartup();if(!startup)throw new Error("Não existe um arranque semanal ativo.");const machine=await db.machine.findUnique({where:{id:machineId}});if(!machine||machine.status!=="RUNNING")throw new Error("A máquina selecionada está parada.")}

// A machine stopped during the week still needs its weekly cleaning record.
export async function getWeeklyShutdownMachines(startupId:number, client:typeof db=db) {
  return client.query<any[]>(`
    SELECT m.* FROM Machine m
    WHERE m.status='RUNNING'
       OR EXISTS (SELECT 1 FROM WeeklyStartupMachine sm WHERE sm.machineId=m.id AND sm.weeklyStartupId=?)
       OR EXISTS (
         SELECT 1 FROM MachineEvent e INNER JOIN WeeklyStartup s ON s.id=?
         WHERE e.machineId=m.id AND e.toStatus='RUNNING'
           AND e.occurredAt >= COALESCE(s.finalizedAt,s.startupDate)
       )
    ORDER BY m.code`,[startupId,startupId]);
}
