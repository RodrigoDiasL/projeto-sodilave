import { LotStatus, Prisma } from "@prisma/client";

type StockClient = Prisma.TransactionClient;
type Consumption = { rawMaterialLotId: number; quantityKg: number | Prisma.Decimal | null };
type LockedLot = { id: number; quantityAvailable: unknown; status: LotStatus; supplierLot: string };

function roundKg(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function aggregate(rows: Consumption[]) {
  const totals = new Map<number, number>();
  for (const row of rows) {
    const quantity = Number(row.quantityKg ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Foi encontrada uma quantidade de matéria-prima inválida.");
    totals.set(row.rawMaterialLotId, roundKg((totals.get(row.rawMaterialLotId) ?? 0) + quantity));
  }
  return totals;
}

export async function reconcileProductionStock(tx: StockClient, previousRows: Consumption[], nextRows: Consumption[]) {
  const previous = aggregate(previousRows);
  const next = aggregate(nextRows);
  const ids = [...new Set([...previous.keys(), ...next.keys()])].sort((a, b) => a - b);
  if (!ids.length) return;

  const lots = await tx.$queryRaw<LockedLot[]>(Prisma.sql`
    SELECT id, quantityAvailable, status, supplierLot
    FROM RawMaterialLot
    WHERE id IN (${Prisma.join(ids)})
    FOR UPDATE
  `);
  if (lots.length !== ids.length) throw new Error("Um dos lotes de matéria-prima já não existe.");

  for (const id of ids) {
    const lot = lots.find((row) => row.id === id)!;
    const oldQuantity = previous.get(id) ?? 0;
    const newQuantity = next.get(id) ?? 0;
    const delta = roundKg(newQuantity - oldQuantity);
    const available = roundKg(Number(lot.quantityAvailable));

    if (delta > 0 && lot.status !== LotStatus.ACTIVE) {
      throw new Error(`O lote ${lot.supplierLot} já não está ativo e não pode suportar consumo adicional.`);
    }

    const resultingAvailable = roundKg(available - delta);
    if (resultingAvailable < -0.0005) {
      throw new Error(`A quantidade consumida excede o stock disponível do lote ${lot.supplierLot}.`);
    }

    let nextStatus = lot.status;
    if (resultingAvailable <= 0.0005 && lot.status === LotStatus.ACTIVE) nextStatus = LotStatus.DEPLETED;
    if (resultingAvailable > 0.0005 && lot.status === LotStatus.DEPLETED) nextStatus = LotStatus.ACTIVE;

    await tx.rawMaterialLot.update({
      where: { id },
      data: {
        quantityAvailable: Math.max(0, resultingAvailable),
        status: nextStatus,
      },
    });
  }
}
