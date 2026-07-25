import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { ProductionForm } from "@/components/ProductionForm";
import { getProductionFormData } from "@/lib/production-form-data";
import { getShiftWindow } from "@/lib/shift";
import { db } from "@/lib/db";
import { productionToInitial } from "@/lib/production-initial";

export default async function NewProductionPage({ searchParams }: { searchParams: Promise<{ extraMachine?: string }> }) {
  const q = await searchParams;
  const data = await getProductionFormData();
  const window = getShiftWindow();
  const records = await db.production.findMany({
    where: { startedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } },
    include: { materials: { include: { rawMaterialLot: true } }, tests: true },
    orderBy: { createdAt: "asc" },
  });
  const extraMachineId = Number(q.extraMachine || 0);

  return <>
    <PageIntro title="Produção do turno" subtitle="Preencha o registo de cada máquina em funcionamento. Cada máquina tem o seu próprio rascunho." />
    <div className="notice"><strong>{window.label}:</strong> {window.hours}. Só pode existir uma produção normal por máquina; produções adicionais exigem justificação.</div>
    <div className="machine-forms-stack">
      {data.machines.map((machine) => {
        const machineRecords = records.filter((row) => row.machineId === machine.id);
        const primary = machineRecords[0];
        const extras = machineRecords.slice(1);
        return <section key={machine.id} id={`machine-${machine.id}`} className="machine-production-section">
          {primary?.status === "FINALIZED" ? <div className="panel finalized-summary"><h2>Máquina {machine.code}</h2><p>Produção principal já finalizada: <strong>{primary.productionLot}</strong>.</p><Link className="btn secondary" href={`/production/details/${primary.id}`}>Ver detalhes</Link></div> : <ProductionForm {...data} machines={[machine]} fixedMachine={machine} initial={primary ? productionToInitial(primary) : undefined} />}
          {extras.map((row) => row.status === "DRAFT" ? <ProductionForm key={row.id} {...data} machines={[machine]} fixedMachine={machine} additional initial={productionToInitial(row)} /> : <div key={row.id} className="panel finalized-summary"><p>Produção adicional finalizada: <strong>{row.productionLot}</strong></p><Link className="btn secondary" href={`/production/details/${row.id}`}>Ver detalhes</Link></div>)}
          {extraMachineId === machine.id && <ProductionForm {...data} machines={[machine]} fixedMachine={machine} additional />}
          <div className="additional-production-link"><Link className="btn secondary" href={`/production/new?extraMachine=${machine.id}#machine-${machine.id}`}>+ Registar produção adicional nesta máquina</Link></div>
        </section>;
      })}
    </div>
  </>;
}
