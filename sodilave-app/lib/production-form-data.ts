import { db } from "@/lib/db";
import { getActiveWeeklyMachineIds } from "@/lib/active-machines";
import { getConfirmationWorkers } from "@/lib/second-worker-confirmation";
import { getStorageLocations } from "@/lib/stock-map";

type ProductMachineRow={productId:number;machineId:number};

export async function getProductionFormData(options: { machineIds?:number[]; allActiveMachines?: boolean; currentUserId?: number; existingProductionId?: number } = {}) {
  const existing = options.existingProductionId
    ? await db.production.findUnique({where:{id:options.existingProductionId},include:{materials:{include:{rawMaterialLot:true}}}})
    : null;
  const usedLotIds = (existing?.materials ?? []).map((row:any)=>row.rawMaterialLotId);
  const usedMaterialIds = (existing?.materials ?? []).map((row:any)=>row.rawMaterialLot.rawMaterialId);
  // Credit only stock actually booked by this production; a draft has no credit.
  const recorded = existing?.status === "FINALIZED"
    ? await db.query<{rawMaterialLotId:number;quantityKg:string}[]>("SELECT rawMaterialLotId,quantityKg FROM ProductionStockConsumption WHERE productionId=?",[existing.id])
    : [];
  const credit = new Map(recorded.map(row=>[row.rawMaterialLotId,Number(row.quantityKg)]));
  const runningMachineIds = options.allActiveMachines ? [] : await getActiveWeeklyMachineIds();
  const machineWhere = options.machineIds ? {id:{in:options.machineIds}} : options.allActiveMachines
    ? { active: true }
    : { active: true, id: { in: runningMachineIds } };

  const [machineRows, productRows, rawMaterialRows, lotRows, workers, productMachineRows, storageLocations] = await Promise.all([
    db.machine.findMany({ where: machineWhere, orderBy: { code: "asc" } }),
    db.product.findMany({ where: { OR: [{ active: true }, { id: existing?.productId ?? 0 }] }, orderBy: { name: "asc" } }),
    db.rawMaterial.findMany({ where: { OR: [{active:true},{id:{in:usedMaterialIds}}] }, orderBy: { name: "asc" } }),
    db.rawMaterialLot.findMany({
      where: { OR: [{status:"ACTIVE",quantityAvailable:{gt:0}},{id:{in:usedLotIds}}] },
      include: { rawMaterial: true },
      orderBy: { receivedAt: "asc" },
    }),
    getConfirmationWorkers(options.currentUserId),
    db.$queryRaw<ProductMachineRow[]>`SELECT productId,machineId FROM ProductMachine`,
    getStorageLocations(),
  ]);

  return {
    machines: machineRows.map(({ id, code, name }) => ({ id, code, name })),
    products: productRows.map(({ id, code, name, unitsPerPackage, productionUnit }) => ({
      id, code, name,
      unitsPerPackage: existing?.status === "FINALIZED" && existing.productId === id ? (existing.unitsPerPackageSnapshot ?? unitsPerPackage) : unitsPerPackage,
      productionUnit: String((existing?.status === "FINALIZED" && existing.productId === id ? existing.productionUnitSnapshot : null) ?? productionUnit ?? "BAG"),
      machineIds: productMachineRows.filter(row=>row.productId===id).map(row=>row.machineId),
    })),
    rawMaterials: rawMaterialRows.map(({ id, name }) => ({ id, name })),
    lots: lotRows.map((lot) => ({
      id: lot.id,
      supplierLot: lot.supplierLot,
      manufacturer: lot.manufacturer,
      supplier: lot.supplier,
      quantityAvailable: String(lot.quantityAvailable),
      quantityRecorded: String(credit.get(lot.id) ?? 0),
      quantityEditable: String(Math.round(((lot.status === "ACTIVE" ? Number(lot.quantityAvailable) : 0) + (credit.get(lot.id) ?? 0)) * 1000) / 1000),
      rawMaterial: { id: lot.rawMaterial.id, name: lot.rawMaterial.name },
    })),
    workers,
    storageLocations,
  };
}
