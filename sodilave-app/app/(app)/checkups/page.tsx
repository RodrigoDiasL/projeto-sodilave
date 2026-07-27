import { db } from "@/lib/db";
import { PageIntro } from "@/components/PageIntro";
import { CheckupForms } from "@/components/CheckupForms";
import { SecondWorkerConfirmationPortals } from "@/components/SecondWorkerConfirmationPortals";
import { getActiveWeeklyMachines } from "@/lib/active-machines";
import { getShiftWindow } from "@/lib/shift";
import { getConfirmationWorkers } from "@/lib/second-worker-confirmation";
import { requireUser } from "@/lib/auth";

export default async function Page() {
  const user = await requireUser();
  const machines = await getActiveWeeklyMachines();
  const window = getShiftWindow();
  const [machineRecords, generalRecord, workers] = await Promise.all([
    db.machineCheckup.findMany({ where: { observedAt: { gte: window.start, lt: window.end }, machineId: { in: machines.map((m) => m.id) }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
    db.shiftGeneralCheck.findFirst({ where: { observedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
    getConfirmationWorkers(user.id),
  ]);
  return <>
    <PageIntro title="Verificações de Turno" subtitle="Preencha a verificação geral e o formulário de cada máquina em funcionamento."/>
    <div className="notice"><strong>{window.label}:</strong> {window.hours}. Os rascunhos podem ser completados ao longo do turno.{user.role === "ADMIN" && " O administrador pode finalizar diretamente, sem confirmação de um colega."}</div>
    <CheckupForms machines={machines} machineRecords={JSON.parse(JSON.stringify(machineRecords))} generalRecord={generalRecord ? JSON.parse(JSON.stringify(generalRecord)) : undefined}/>
    <SecondWorkerConfirmationPortals workers={workers} selector=".machine-forms-stack form" disabled={user.role === "ADMIN"} />
  </>;
}
