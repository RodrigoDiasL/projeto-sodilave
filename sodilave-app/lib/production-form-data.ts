import { db } from "@/lib/db";
import { getActiveWeeklyMachineIds } from "@/lib/active-machines";
import { getConfirmationWorkers } from "@/lib/second-worker-confirmation";

type ProductMachineRow={productId:number;machineId:number};

export async function getProductionFormData(options: { allActiveMachines?: boolean; currentUserId?: number } = {}) {
  const runningMachineIds = options.allActiveMachines ? [] : await getActiveWeeklyMachineIds();
  const machineWhere = options.allActiveMachines
    ? { active: true }
    : { active: true, id: { in: runningMachineIds } };

  const [machineRows, productRows, rawMaterialRows, lotRows, workers, productMachineRows] = await Promise.all([
    db.machine.findMany({ where: machineWhere, orderBy: { code: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.rawMaterial.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.rawMaterialLot.findMany({
      where: { status: "ACTIVE", quantityAvailable: { gt: 0 } },
      include: { rawMaterial: true },
      orderBy: { receivedAt: "asc" },
    }),
    getConfirmationWorkers(options.currentUserId),
    db.$queryRaw<ProductMachineRow[]>`SELECT productId,machineId FROM ProductMachine`,
  ]);

  return {
    machines: machineRows.map(({ id, code, name }) => ({ id, code, name })),
    products: productRows.map(({ id, code, name, unitsPerPackage }) => ({
      id, code, name, unitsPerPackage,
      machineIds: productMachineRows.filter(row=>row.productId===id).map(row=>row.machineId),
    })),
    rawMaterials: rawMaterialRows.map(({ id, name }) => ({ id, name })),
    lots: lotRows.map((lot) => ({
      id: lot.id,
      supplierLot: lot.supplierLot,
      quantityAvailable: String(lot.quantityAvailable),
      rawMaterial: { id: lot.rawMaterial.id, name: lot.rawMaterial.name },
    })),
    workers,
  };
}
