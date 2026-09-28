import {db,type DbTransaction} from "@/lib/db";
// During handover include machines that ran in the original shift, even after shutdown.
export async function getCheckupMachines(window:{start:Date;end:Date},now=new Date(),client:DbTransaction=db){
  if(now<window.end)return client.machine.findMany({where:{active:true,status:"RUNNING"},orderBy:{code:"asc"}});
  return client.query<any[]>(`SELECT m.* FROM Machine m WHERE
    (m.active=1 AND m.status='RUNNING')
    OR EXISTS (SELECT 1 FROM MachineCheckup c WHERE c.machineId=m.id AND c.observedAt>=? AND c.observedAt<? AND c.status<>'CANCELLED')
    OR EXISTS (SELECT 1 FROM MachineEvent e WHERE e.machineId=m.id AND e.occurredAt>=? AND e.occurredAt<? AND (e.fromStatus='RUNNING' OR e.toStatus='RUNNING'))
    OR (SELECT e.toStatus FROM MachineEvent e WHERE e.machineId=m.id AND e.occurredAt<? ORDER BY e.occurredAt DESC,e.id DESC LIMIT 1)='RUNNING'
    ORDER BY m.code`,[window.start,window.end,window.start,window.end,window.end]);
}
