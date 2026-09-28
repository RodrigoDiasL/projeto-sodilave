import { db } from "@/lib/db";
import type { ProductionUnit, StorageZoneType } from "@/lib/stock-map";

export type FinishedLotLocation = {
  locationId: number;
  warehouseCode: string;
  warehouseName: string;
  zoneType: StorageZoneType;
  code: string;
  quantityPackages: number;
};

export type AvailableFinishedLot = {
  productionId: number;
  lotCode: string;
  productId: number;
  productCode: string;
  productName: string;
  machineCode: string;
  productionDate: string;
  productionUnit: ProductionUnit;
  unitsPerPackage: number;
  producedPackages: number;
  dispatchedUnits: number;
  availablePackages: number;
  availableUnits: number;
  locations: FinishedLotLocation[];
};

export type RecentLotDispatch = {
  id: number;
  salesOrderId: number | null;
  customerName: string;
  orderReference: string;
  invoiceNumber: string;
  productCode: string;
  productName: string;
  orderedQuantityUnits: number;
  dispatchDate: string;
  createdByName: string;
  lots: string;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export async function getAvailableFinishedLots(): Promise<AvailableFinishedLot[]> {
  const rows = await db.query<any[]>(`
    SELECT
      p.id AS productionId,
      COALESCE(pla.labelCode, p.productionLot) AS lotCode,
      p.productId,
      pr.code AS productCode,
      pr.name AS productName,
      m.code AS machineCode,
      DATE_FORMAT(p.startedAt, '%Y-%m-%d') AS productionDate,
      COALESCE(p.productionUnitSnapshot, pr.productionUnit, 'BAG') AS productionUnit,
      COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) AS unitsPerPackage,
      COALESCE(p.quantityProduced, 0) AS producedPackages,
      COALESCE(outbound.dispatchedUnits, 0) AS dispatchedUnits,
      b.locationId,
      b.quantityPackages,
      l.warehouseCode,
      l.warehouseName,
      l.zoneType,
      l.code
    FROM ProductionStorageBalance b
    INNER JOIN StorageLocation l ON l.id = b.locationId
    INNER JOIN Production p ON p.id = b.productionId
    INNER JOIN Product pr ON pr.id = p.productId
    INNER JOIN Machine m ON m.id = p.machineId
    LEFT JOIN ProductionLotAssociation pla ON pla.productionId = p.id
    LEFT JOIN (
      SELECT line.productionId, SUM(line.quantityUnits) AS dispatchedUnits
      FROM LotDispatchLine line
      INNER JOIN LotDispatch dispatch ON dispatch.id = line.lotDispatchId
      WHERE dispatch.cancelledAt IS NULL
      GROUP BY line.productionId
    ) outbound ON outbound.productionId = p.id
    WHERE p.status = 'FINALIZED' AND p.recordOrigin<>'HISTORICAL_IMPORT'
      AND b.quantityPackages > 0
      AND COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) > 0
    ORDER BY p.startedAt ASC, p.id ASC, l.warehouseCode, FIELD(l.zoneType,'STACK','PALLET'), l.rowNumber, l.columnNumber
  `);

  const grouped = new Map<number, AvailableFinishedLot>();
  for (const row of rows) {
    const productionId = Number(row.productionId);
    const unitsPerPackage = Number(row.unitsPerPackage);
    let lot = grouped.get(productionId);
    if (!lot) {
      lot = {
        productionId,
        lotCode: String(row.lotCode),
        productId: Number(row.productId),
        productCode: String(row.productCode),
        productName: String(row.productName),
        machineCode: String(row.machineCode),
        productionDate: String(row.productionDate),
        productionUnit: String(row.productionUnit || "BAG") as ProductionUnit,
        unitsPerPackage,
        producedPackages: Number(row.producedPackages),
        dispatchedUnits: Number(row.dispatchedUnits),
        availablePackages: 0,
        availableUnits: 0,
        locations: [],
      };
      grouped.set(productionId, lot);
    }

    const quantityPackages = Number(row.quantityPackages);
    lot.locations.push({
      locationId: Number(row.locationId),
      warehouseCode: String(row.warehouseCode),
      warehouseName: String(row.warehouseName),
      zoneType: String(row.zoneType) as StorageZoneType,
      code: String(row.code),
      quantityPackages,
    });
    lot.availablePackages += quantityPackages;
    lot.availableUnits += quantityPackages * unitsPerPackage;
  }

  return [...grouped.values()];
}

export async function getRecentLotDispatches(limit = 30): Promise<RecentLotDispatch[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = await db.query<any[]>(`
    SELECT
      d.id,
      oi.salesOrderId,
      DATE_FORMAT(d.cancelledAt, '%Y-%m-%d %H:%i:%s') AS cancelledAt,
      d.cancelReason,
      d.customerName,
      d.orderReference,
      d.invoiceNumber,
      pr.code AS productCode,
      pr.name AS productName,
      d.orderedQuantityUnits,
      DATE_FORMAT(d.dispatchDate, '%Y-%m-%d') AS dispatchDate,
      u.name AS createdByName,
      COALESCE(dispatch_lots.lots, '') AS lots
    FROM LotDispatch d
    LEFT JOIN SalesOrderItem oi ON oi.id=d.salesOrderItemId
    INNER JOIN Product pr ON pr.id = d.productId
    INNER JOIN User u ON u.id = d.createdById
    LEFT JOIN (
      SELECT
        line.lotDispatchId,
        GROUP_CONCAT(
          CONCAT(COALESCE(pla.labelCode, p.productionLot), ' · ', line.quantityUnits, ' un.')
          ORDER BY p.startedAt ASC, p.id ASC
          SEPARATOR ' | '
        ) AS lots
      FROM LotDispatchLine line
      INNER JOIN Production p ON p.id = line.productionId
      LEFT JOIN ProductionLotAssociation pla ON pla.productionId = p.id
      GROUP BY line.lotDispatchId
    ) dispatch_lots ON dispatch_lots.lotDispatchId = d.id
    ORDER BY d.dispatchDate DESC, d.id DESC
    LIMIT ${safeLimit}
  `);

  return rows.map((row) => ({
    id: Number(row.id),
    salesOrderId: row.salesOrderId ? Number(row.salesOrderId) : null,
    cancelledAt: row.cancelledAt ? String(row.cancelledAt) : null,
    cancelReason: row.cancelReason ? String(row.cancelReason) : null,
    customerName: String(row.customerName),
    orderReference: String(row.orderReference),
    invoiceNumber: String(row.invoiceNumber),
    productCode: String(row.productCode),
    productName: String(row.productName),
    orderedQuantityUnits: Number(row.orderedQuantityUnits),
    dispatchDate: String(row.dispatchDate),
    createdByName: String(row.createdByName),
    lots: String(row.lots || ""),
  }));
}
