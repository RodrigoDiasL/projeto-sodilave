import { notFound } from "next/navigation";
import { PageIntro } from "@/components/PageIntro";
import { ProductionForm } from "@/components/ProductionForm";
import { SecondWorkerConfirmationPortals } from "@/components/SecondWorkerConfirmationPortals";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getProductionFormData } from "@/lib/production-form-data";
import { productionToInitial } from "@/lib/production-initial";

type CavityDataRow = { rightInitialWeightG: unknown; rightMidWeightG: unknown };
type CavityTestRow = { type: string; moment: string; result: string };

export default async function EditProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const production = await db.production.findUnique({
    where: { id: Number(id) },
    include: { machine: true, materials: { include: { rawMaterialLot: true } }, tests: true },
  });
  if (!production || production.status === "CANCELLED") notFound();
  if (production.status === "FINALIZED" && user.role !== "ADMIN") {
    const { getShiftWindow } = await import("@/lib/shift");
    if (new Date() >= getShiftWindow(production.startedAt).end) notFound();
  }

  let cavityData: CavityDataRow | undefined;
  let cavityTests: CavityTestRow[] = [];
  if (production.machine.code === "7") {
    const rows = await db.$queryRaw<CavityDataRow[]>`SELECT rightInitialWeightG, rightMidWeightG FROM ProductionCavityData WHERE productionId = ${production.id} LIMIT 1`;
    cavityData = rows[0];
    cavityTests = await db.$queryRaw<CavityTestRow[]>`SELECT type, moment, result FROM ProductionCavityTest WHERE productionId = ${production.id} AND cavity = 'RIGHT'`;
  }

  const data = await getProductionFormData();
  const association = await db.$queryRaw<{ labelCode: string }[]>`SELECT labelCode FROM ProductionLotAssociation WHERE productionId = ${production.id} LIMIT 1`;
  const initial = productionToInitial(production, cavityData, cavityTests);
  initial.productionLot = association[0]?.labelCode ?? production.productionLot;
  const displayLot = association[0]?.labelCode ?? production.productionLot;

  return <>
    <PageIntro title={`${production.status === "FINALIZED" ? "Corrigir" : "Continuar"} produção ${displayLot}`} subtitle={user.role === "ADMIN" ? "O administrador pode concluir ou corrigir este registo sem confirmação de um colega." : "As correções de produções finalizadas só são permitidas até ao fim do respetivo turno."} />
    <ProductionForm {...data} initial={initial} />
    <SecondWorkerConfirmationPortals workers={data.workers} selector="form.machine-production-form" disabled={user.role === "ADMIN"} />
  </>;
}
