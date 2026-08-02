import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { ProductionForm } from "@/components/ProductionForm";
import { SecondWorkerConfirmationPortals } from "@/components/SecondWorkerConfirmationPortals";
import { getProductionFormData } from "@/lib/production-form-data";
import { getShiftWindow } from "@/lib/shift";
import { db } from "@/lib/db";
import { previousProductionToDefaults, productionToInitial } from "@/lib/production-initial";
import { requireUser } from "@/lib/auth";
import { getActiveWeeklyStartup } from "@/lib/active-machines";

export default async function NewProductionPage({ searchParams }: { searchParams: Promise<{ extraMachine?: string }> }) {
  const user = await requireUser();
  const q = await searchParams;
  const data = await getProductionFormData();
  const window = getShiftWindow();
  const startup = await getActiveWeeklyStartup();
  const previousShiftStart = new Date(window.start.getTime() - 8 * 60 * 60 * 1000);
  const previousLowerBound = startup && startup.startupDate > previousShiftStart ? startup.startupDate : previousShiftStart;
  const [records, previousRecords] = await Promise.all([
    db.production.findMany({
      where: { startedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } },
      include: { materials: { include: { rawMaterialLot: true } }, tests: true },
      orderBy: { createdAt: "asc" },
    }),
    startup ? db.production.findMany({
      where: { startedAt: { gte: previousLowerBound, lt: window.start }, status: "FINALIZED" },
      include: { materials: { include: { rawMaterialLot: true } } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    }) : Promise.resolve([]),
  ]);
  const extraMachineId = Number(q.extraMachine || 0);
  const activeLotIds = new Set(data.lots.map((lot) => lot.id));

  return <>
    <PageIntro title="Produção do turno" subtitle="Preencha o registo de cada máquina em funcionamento. Cada máquina tem o seu próprio rascunho." />
    <div className="notice"><strong>{window.label}:</strong> {window.hours}. Só pode existir uma produção normal por máquina; produções adicionais exigem justificação.</div>
    <div className="machine-forms-stack">
      {data.machines.map((machine) => {
        const machineRecords = records.filter((row) => row.machineId === machine.id);
        const primary = machineRecords[0];
        const extras = machineRecords.slice(1);
        const machineProducts = data.products.filter((product) => product.machineIds.includes(machine.id));
        const previous = previousRecords.find((row) => row.machineId === machine.id);
        const previousIsUsable = Boolean(
          previous &&
          machineProducts.some((product) => product.id === previous.productId) &&
          previous.materials.length > 0 &&
          previous.materials.every((material) => activeLotIds.has(material.rawMaterialLotId)),
        );
        const defaults = !primary && previousIsUsable && previous ? previousProductionToDefaults(previous) : undefined;

        return <section key={machine.id} id={`machine-${machine.id}`} className="machine-production-section">
          {primary?.status === "FINALIZED"
            ? <div className="panel finalized-summary"><h2>Máquina {machine.code}</h2><p>Produção principal já finalizada: <strong>{primary.productionLot}</strong>.</p><Link className="btn secondary" href={`/production/details/${primary.id}`}>Ver detalhes</Link></div>
            : <ProductionForm {...data} products={machineProducts} machines={[machine]} fixedMachine={machine} initial={primary ? productionToInitial(primary) : defaults as any} />}
          {!primary && previousIsUsable && <div className="notice muted">Produto e lotes de matéria-prima preenchidos com base no último registo finalizado do turno anterior. Confirme ou altere antes de gravar.</div>}
          {!primary && previous && !previousIsUsable && <div className="notice muted">O registo anterior não foi pré-preenchido porque o produto deixou de estar autorizado nesta máquina ou um dos lotes já não está disponível.</div>}
          {extras.map((row) => row.status === "DRAFT"
            ? <ProductionForm key={row.id} {...data} products={machineProducts} machines={[machine]} fixedMachine={machine} additional initial={productionToInitial(row)} />
            : <div key={row.id} className="panel finalized-summary"><p>Produção adicional finalizada: <strong>{row.productionLot}</strong></p><Link className="btn secondary" href={`/production/details/${row.id}`}>Ver detalhes</Link></div>)}
          {extraMachineId === machine.id && <ProductionForm {...data} products={machineProducts} machines={[machine]} fixedMachine={machine} additional />}
          <div className="additional-production-link"><Link className="btn secondary" href={`/production/new?extraMachine=${machine.id}#machine-${machine.id}`}>+ Registar produção adicional nesta máquina</Link></div>
        </section>;
      })}
    </div>
    <SecondWorkerConfirmationPortals workers={data.workers} selector="form.machine-production-form" disabled={user.role === "ADMIN"} />
  </>;
}
