import { getPastProductionEnabled } from "@/lib/operation-settings";
import { getShiftWindow, formatLocalDateInput } from "@/lib/shift";
import { notFound } from "next/navigation";
import { PageIntro } from "@/components/PageIntro";
import { ProductionForm } from "@/components/ProductionForm";
import { SecondWorkerConfirmationPortals } from "@/components/SecondWorkerConfirmationPortals";
import { db } from "@/lib/db";
import { requireOperationalUser } from "@/lib/auth";
import { getProductionFormData } from "@/lib/production-form-data";
import { productionToInitial } from "@/lib/production-initial";
import { getShiftPeerConfirmation } from "@/lib/second-worker-confirmation";

type CavityDataRow = { rightInitialWeightG: unknown; rightMidWeightG: unknown };
type CavityTestRow = { type: string; moment: string; result: string };

export default async function EditProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOperationalUser();
  const { id } = await params;
  const production = await db.production.findUnique({
    where: { id: Number(id) },
    include: { machine: true, materials: { include: { rawMaterialLot: true } }, tests: true },
  });
  if (!production || production.recordOrigin === "INITIAL_STOCK" || production.status === "CANCELLED") notFound();
  if (production.status === "FINALIZED" && user.role !== "ADMIN") {
    if (new Date() >= getShiftWindow(production.startedAt).end) notFound();
  }

  const pastDraft = production.status === "DRAFT" && getShiftWindow(production.startedAt).end <= new Date();
  if (pastDraft && !await getPastProductionEnabled()) return <>
    <PageIntro title="Registo de produção passada" subtitle="Este rascunho pertence a um turno já terminado."/>
    <div className="notice">O registo de produção passada está desativado. Peça a um administrador para o ativar nas definições.</div>
  </>;
  const historicalContext = pastDraft ? { date: formatLocalDateInput(production.startedAt), shiftCode: getShiftWindow(production.startedAt).code } : undefined;

  let cavityData: CavityDataRow | undefined;
  let cavityTests: CavityTestRow[] = [];
  if (production.machine.code === "7") {
    const rows = await db.$queryRaw<CavityDataRow[]>`SELECT rightInitialWeightG, rightMidWeightG FROM ProductionCavityData WHERE productionId = ${production.id} LIMIT 1`;
    cavityData = rows[0];
    cavityTests = await db.$queryRaw<CavityTestRow[]>`SELECT type, moment, result FROM ProductionCavityTest WHERE productionId = ${production.id} AND cavity = 'RIGHT'`;
  }

  const [data, peerConfirmation] = await Promise.all([
    getProductionFormData({ currentUserId: user.id, existingProductionId: production.id }),
    user.role === "ADMIN" ? Promise.resolve(null) : getShiftPeerConfirmation(user.id),
  ]);
  const association = await db.$queryRaw<{ labelCode: string }[]>`SELECT labelCode FROM ProductionLotAssociation WHERE productionId = ${production.id} LIMIT 1`;
  const initial = productionToInitial(production, cavityData, cavityTests);
  initial.productionLot = association[0]?.labelCode ?? production.productionLot;
  const displayLot = association[0]?.labelCode ?? production.productionLot;
  const products=data.products.filter(product=>product.machineIds.includes(production.machineId)||product.id===production.productId);

  return <>
    <PageIntro title={`${production.status === "FINALIZED" ? "Corrigir" : "Continuar"} produção ${displayLot}`} subtitle={user.role === "ADMIN" ? "O administrador pode concluir ou corrigir este registo sem confirmação de um colega." : "As correções de produções finalizadas só são permitidas até ao fim do respetivo turno."} />
    <ProductionForm draftScope={`${user.id}:${getShiftWindow(production.startedAt).start.toISOString()}`} {...data} products={products} machines={[production.machine]} fixedMachine={production.machine} initial={initial} historicalContext={historicalContext} storageLocked={production.status === "FINALIZED"} />
    <SecondWorkerConfirmationPortals workers={data.workers} selector="form.machine-production-form" disabled={user.role === "ADMIN" || Boolean(peerConfirmation)} />
  </>;
}
