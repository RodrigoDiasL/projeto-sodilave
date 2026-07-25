import { notFound } from "next/navigation";
import { PageIntro } from "@/components/PageIntro";
import { ProductionForm } from "@/components/ProductionForm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getProductionFormData } from "@/lib/production-form-data";
import { productionToInitial } from "@/lib/production-initial";

export default async function EditProductionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const production = await db.production.findUnique({
    where: { id: Number(id) },
    include: { materials: { include: { rawMaterialLot: true } }, tests: true },
  });
  if (!production || production.status === "CANCELLED") notFound();
  if (production.status === "FINALIZED") { const { getShiftWindow } = await import("@/lib/shift"); if (new Date() >= getShiftWindow(production.startedAt).end) notFound(); }
  const data = await getProductionFormData();
  const initial = productionToInitial(production);

  return <>
    <PageIntro title={`${production.status === "FINALIZED" ? "Corrigir" : "Continuar"} produção ${production.productionLot}`} subtitle="As correções de produções finalizadas só são permitidas até ao fim do respetivo turno." />
    <ProductionForm {...data} initial={initial} />
  </>;
}
