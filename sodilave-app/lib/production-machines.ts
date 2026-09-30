import {db} from "@/lib/db";
import {getActiveWeeklyMachineIds} from "@/lib/active-machines";
// A historical machine needs evidence of running during at least part of the selected shift.
export async function getProductionMachinesForPeriod(window:{start:Date;end:Date},now=new Date()){
  const currentIds=window.start<=now&&now<window.end?await getActiveWeeklyMachineIds():[];
  const rows=await db.query<any[]>(`SELECT m.* FROM Machine m WHERE
    EXISTS (SELECT 1 FROM Production p WHERE p.machineId=m.id AND p.recordOrigin='PRODUCTION' AND p.status<>'CANCELLED' AND p.startedAt>=? AND p.startedAt<?)
    OR EXISTS (SELECT 1 FROM MachineEvent e WHERE e.machineId=m.id AND e.occurredAt>=? AND e.occurredAt<? AND (e.toStatus='RUNNING' OR e.fromStatus='RUNNING'))
    OR (SELECT e.toStatus FROM MachineEvent e WHERE e.machineId=m.id AND e.occurredAt<? ORDER BY e.occurredAt DESC,e.id DESC LIMIT 1)='RUNNING'
    OR m.id IN (${currentIds.length?currentIds.map(()=>"?").join(","):"NULL"})
    ORDER BY m.code`,[window.start,window.end,window.start,window.end,window.start,...currentIds]);
  return rows;
}
