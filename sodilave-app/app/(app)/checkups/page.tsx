import { db } from "@/lib/db";
import { PageIntro } from "@/components/PageIntro";
import { CheckupForms } from "@/components/CheckupForms";
import { getActiveWeeklyMachines } from "@/lib/active-machines";
import { getShiftWindow } from "@/lib/shift";

export default async function Page() {
  const machines = await getActiveWeeklyMachines();
  const window = getShiftWindow();
  const [machineRecords, generalRecord] = await Promise.all([
    db.machineCheckup.findMany({ where: { observedAt: { gte: window.start, lt: window.end }, machineId: { in: machines.map((m) => m.id) }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
    db.shiftGeneralCheck.findFirst({ where: { observedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" } }),
  ]);
  return <><PageIntro title="Verificações de Turno" subtitle="Preencha a verificação geral e o formulário de cada máquina em funcionamento."/><div className="notice"><strong>{window.label}:</strong> {window.hours}. Os rascunhos podem ser completados ao longo do turno.</div><CheckupForms machines={machines} machineRecords={JSON.parse(JSON.stringify(machineRecords))} generalRecord={generalRecord ? JSON.parse(JSON.stringify(generalRecord)) : undefined}/></>;
}
