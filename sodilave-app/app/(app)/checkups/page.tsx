import Link from "next/link";
import { db } from "@/lib/db";
import { PageIntro } from "@/components/PageIntro";
import { CheckupForms } from "@/components/CheckupForms";
import { getActiveWeeklyStartup } from "@/lib/active-machines";
import { getCheckupMachines } from "@/lib/checkup-machines";
import { getShiftWindow, getProductionEntryWindow } from "@/lib/shift";
import { getConfirmationWorkers, getShiftPeerConfirmation } from "@/lib/second-worker-confirmation";
import { requireOperationalUser } from "@/lib/auth";

export default async function Page({searchParams}:{searchParams:Promise<{current?:string}>}) {
  const user = await requireOperationalUser();
  const query=await searchParams;
  const now=new Date();
  const window=query.current==="1"?getShiftWindow(now):getProductionEntryWindow(now);
  const inGrace=window.end<=now;
  const startup=await getActiveWeeklyStartup();
  const machines=inGrace||startup?await getCheckupMachines(window,now):[];
  const [machineRecords, generalRecord, workers, peerConfirmation] = await Promise.all([
    db.machineCheckup.findMany({ where: { observedAt: { gte: window.start, lt: window.end }, machineId: { in: machines.map((m) => m.id) }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
    db.shiftGeneralCheck.findFirst({ where: { observedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
    getConfirmationWorkers(user.id),
    user.role === "ADMIN" ? Promise.resolve(null) : getShiftPeerConfirmation(user.id,window.start),
  ]);
  return <>
    <PageIntro title="Verificações de Turno" subtitle="Preencha a verificação geral e o formulário de cada máquina em funcionamento."/>
    <div className="notice"><strong>{window.label}:</strong> {window.hours}. Os rascunhos podem ser completados até 30 minutos depois do fim do turno.{user.role === "ADMIN" && " O administrador pode finalizar diretamente, sem confirmação de um colega."}{peerConfirmation && ` Colega de turno já confirmado: ${peerConfirmation.name}.`}</div>
    {inGrace&&<div className="notice">Tolerância de fecho: estas verificações pertencem ao turno anterior, até 30 minutos após o seu fim. <Link className="btn secondary" href="/checkups?current=1">Registar verificações do turno atual</Link></div>}
    <CheckupForms key={window.start.toISOString()} shiftStart={window.start.toISOString()} workers={workers} needsConfirmation={user.role !== "ADMIN" && !peerConfirmation} machines={machines} machineRecords={JSON.parse(JSON.stringify(machineRecords))} generalRecord={generalRecord ? JSON.parse(JSON.stringify(generalRecord)) : undefined}/>
  </>;
}
