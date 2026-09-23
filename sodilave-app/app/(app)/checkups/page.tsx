import { db } from "@/lib/db";
import { PageIntro } from "@/components/PageIntro";
import { CheckupForms } from "@/components/CheckupForms";
import { getActiveWeeklyMachines } from "@/lib/active-machines";
import { getShiftWindow } from "@/lib/shift";
import { getConfirmationWorkers, getShiftPeerConfirmation } from "@/lib/second-worker-confirmation";
import { requireOperationalUser } from "@/lib/auth";

export default async function Page() {
  const user = await requireOperationalUser();
  const machines = await getActiveWeeklyMachines();
  const window = getShiftWindow();
  const [machineRecords, generalRecord, workers, peerConfirmation] = await Promise.all([
    db.machineCheckup.findMany({ where: { observedAt: { gte: window.start, lt: window.end }, machineId: { in: machines.map((m) => m.id) }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
    db.shiftGeneralCheck.findFirst({ where: { observedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
    getConfirmationWorkers(user.id),
    user.role === "ADMIN" ? Promise.resolve(null) : getShiftPeerConfirmation(user.id),
  ]);
  return <>
    <PageIntro title="Verificações de Turno" subtitle="Preencha a verificação geral e o formulário de cada máquina em funcionamento."/>
    <div className="notice"><strong>{window.label}:</strong> {window.hours}. Os rascunhos podem ser completados ao longo do turno.{user.role === "ADMIN" && " O administrador pode finalizar diretamente, sem confirmação de um colega."}{peerConfirmation && ` Colega de turno já confirmado: ${peerConfirmation.name}.`}</div>
    <CheckupForms key={window.start.toISOString()} shiftStart={window.start.toISOString()} workers={workers} needsConfirmation={user.role !== "ADMIN" && !peerConfirmation} machines={machines} machineRecords={JSON.parse(JSON.stringify(machineRecords))} generalRecord={generalRecord ? JSON.parse(JSON.stringify(generalRecord)) : undefined}/>
  </>;
}
