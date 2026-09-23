import Link from "next/link";
import { getPastProductionEnabled } from "@/lib/operation-settings";
import { ProductionPeriodSelector } from "@/components/ProductionPeriodSelector";
import { redirect } from "next/navigation";
import { PageIntro } from "@/components/PageIntro";
import { ProductionForm } from "@/components/ProductionForm";
import { SecondWorkerConfirmationPortals } from "@/components/SecondWorkerConfirmationPortals";
import { getProductionFormData } from "@/lib/production-form-data";
import { getShiftWindow, getShiftWindowForDate, type ShiftCode } from "@/lib/shift";
import { db } from "@/lib/db";
import { previousProductionToDefaults, productionToInitial } from "@/lib/production-initial";
import { requireOperationalUser } from "@/lib/auth";
import { getActiveWeeklyStartup } from "@/lib/active-machines";
import { getShiftPeerConfirmation } from "@/lib/second-worker-confirmation";

export default async function NewProductionPage({ searchParams }: { searchParams: Promise<{ extraMachine?: string; date?: string; shift?: string }> }) {
  const user = await requireOperationalUser();
  const q = await searchParams;

  const pastProductionEnabled = await getPastProductionEnabled();
  const historicalRequested = Boolean(q.date || q.shift);
  if (historicalRequested && !pastProductionEnabled) redirect("/production/new");

  let historicalWindow: ReturnType<typeof getShiftWindowForDate> | null = null;
  if (historicalRequested) {
    if (!q.date || !["A", "B", "C"].includes(String(q.shift))) redirect("/production");
    let selectionError = "";
    try {
      historicalWindow = getShiftWindowForDate(q.date, q.shift as ShiftCode);
      if (historicalWindow.end > new Date()) selectionError = "Selecione um turno já terminado. Para o turno em curso, use o registo do turno atual.";
    } catch { selectionError = "Selecione uma data válida."; }
    if (selectionError) return <>
      <PageIntro title="Registo de produção passada" subtitle="Escolha o dia e o turno a registar."/>
      <ProductionPeriodSelector enabled={pastProductionEnabled} date={q.date} shift={q.shift}/>
      <div className="alert error" role="alert">{selectionError}</div>
    </>;

  }

  const data = await getProductionFormData({ allActiveMachines: Boolean(historicalWindow), currentUserId: user.id });
  const window = historicalWindow ?? getShiftWindow();
  const startup = historicalWindow ? null : await getActiveWeeklyStartup();
  const peerConfirmation = user.role === "ADMIN" ? null : await getShiftPeerConfirmation(user.id);
  const previousShiftStart = new Date(window.start.getTime() - 8 * 60 * 60 * 1000);
  const previousLowerBound = historicalWindow
    ? previousShiftStart
    : startup && startup.startupDate > previousShiftStart ? startup.startupDate : previousShiftStart;

  const [records, previousRecords] = await Promise.all([
    db.production.findMany({
      where: { startedAt: { gte: window.start, lt: window.end }, status: { not: "CANCELLED" } },
      include: { materials: { include: { rawMaterialLot: true } }, tests: true },
      orderBy: { createdAt: "asc" },
    }),
    historicalWindow || startup ? db.production.findMany({
      where: { startedAt: { gte: previousLowerBound, lt: window.start }, status: "FINALIZED" },
      include: { materials: { include: { rawMaterialLot: true } } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    }) : Promise.resolve([]),
  ]);

  const extraMachineId = historicalWindow ? 0 : Number(q.extraMachine || 0);
  const activeLotIds = new Set(data.lots.map((lot) => lot.id));
  const historicalContext = historicalWindow && q.date
    ? { date: q.date, shiftCode: historicalWindow.code }
    : undefined;
  const contextQuery = historicalContext ? `date=${encodeURIComponent(historicalContext.date)}&shift=${historicalContext.shiftCode}&` : "";

  return <>
    <PageIntro
      title={historicalWindow ? "Registo de produção passada" : "Produção do turno"}
      subtitle={historicalWindow
        ? `Registo relativo a ${window.start.toLocaleDateString("pt-PT")} · ${window.label}.`
        : "Preencha o registo de cada máquina em funcionamento. Cada máquina tem o seu próprio rascunho."}
    />
    <ProductionPeriodSelector key={`${q.date ?? "current"}:${q.shift ?? ""}`} enabled={pastProductionEnabled} date={q.date} shift={q.shift}/>
    <div className="notice">
      <strong>{window.label}:</strong> {window.hours}.
      {historicalWindow
        ? " Produção passada: só é permitida uma produção normal por máquina neste dia e turno."
        : " Só pode existir uma produção normal por máquina; produções adicionais exigem justificação."}
      {peerConfirmation && ` Colega de turno já confirmado: ${peerConfirmation.name}.`}
    </div>
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
          previous.materials.every((material:any) => activeLotIds.has(material.rawMaterialLotId)),
        );
        const defaults = !primary && previousIsUsable && previous ? previousProductionToDefaults(previous) : undefined;

        return <section key={`${machine.id}:${window.start.toISOString()}`} id={`machine-${machine.id}`} className="machine-production-section">
          {primary?.status === "FINALIZED"
            ? <div className="panel finalized-summary"><h2>Máquina {machine.code}</h2><p>Produção principal já finalizada: <strong>{primary.productionLot}</strong>.</p><Link className="btn secondary" href={`/production/details/${primary.id}`}>Ver detalhes</Link></div>
            : <ProductionForm draftScope={`${user.id}:${window.start.toISOString()}`} {...data} products={machineProducts} machines={[machine]} fixedMachine={machine} initial={primary ? productionToInitial(primary) : defaults as any} historicalContext={historicalContext} />}
          {!primary && previousIsUsable && <div className="notice muted">Produto e lotes de matéria-prima preenchidos com base no último registo finalizado do turno anterior. Confirme ou altere antes de gravar.</div>}
          {!primary && previous && !previousIsUsable && <div className="notice muted">O registo anterior não foi pré-preenchido porque o produto deixou de estar autorizado nesta máquina ou um dos lotes já não está disponível.</div>}
          {extras.map((row) => row.status === "DRAFT"
            ? <ProductionForm key={row.id} draftScope={`${user.id}:${window.start.toISOString()}`} {...data} products={machineProducts} machines={[machine]} fixedMachine={machine} additional initial={productionToInitial(row)} />
            : <div key={row.id} className="panel finalized-summary"><p>Produção adicional finalizada: <strong>{row.productionLot}</strong></p><Link className="btn secondary" href={`/production/details/${row.id}`}>Ver detalhes</Link></div>)}
          {!historicalWindow && extraMachineId === machine.id && <ProductionForm draftScope={`${user.id}:${window.start.toISOString()}`} {...data} products={machineProducts} machines={[machine]} fixedMachine={machine} additional />}
          {!historicalWindow && <div className="additional-production-link"><Link className="btn secondary" href={`/production/new?${contextQuery}extraMachine=${machine.id}#machine-${machine.id}`}>+ Registar produção adicional nesta máquina</Link></div>}
        </section>;
      })}
    </div>
    <SecondWorkerConfirmationPortals workers={data.workers} selector="form.machine-production-form" disabled={user.role === "ADMIN" || Boolean(peerConfirmation)} />
  </>;
}
