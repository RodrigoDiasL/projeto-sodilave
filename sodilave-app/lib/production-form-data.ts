import { db } from "@/lib/db";
import { getActiveWeeklyMachineIds } from "@/lib/active-machines";

export async function getProductionFormData() {
  const runningMachineIds = await getActiveWeeklyMachineIds();
  const [machineRows, productRows, rawMaterialRows, lotRows] = await Promise.all([
    db.machine.findMany({ where: { active: true, id: { in: runningMachineIds } }, orderBy: { code: "asc" } }),
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.rawMaterial.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.rawMaterialLot.findMany({
      where: { status: "ACTIVE", quantityAvailable: { gt: 0 } },
      include: { rawMaterial: true },
      orderBy: { receivedAt: "asc" },
    }),
  ]);

  return {
    machines: machineRows.map(({ id, code, name }) => ({ id, code, name })),
    products: productRows.map(({ id, code, name, unitsPerPackage }) => ({ id, code, name, unitsPerPackage })),
    rawMaterials: rawMaterialRows.map(({ id, name }) => ({ id, name })),
    lots: lotRows.map((lot) => ({
      id: lot.id,
      supplierLot: lot.supplierLot,
      quantityAvailable: String(lot.quantityAvailable),
      rawMaterial: { id: lot.rawMaterial.id, name: lot.rawMaterial.name },
    })),
  };
}
