import { db } from "@/lib/db";

export type AvailableFinishedLot = {
  productionId: number;
  lotCode: string;
  productId: number;
  productCode: string;
  productName: string;
  machineCode: string;
  productionDate: string;
  unitsPerPackage: number;
  producedPackages: number;
  producedUnits: number;
  dispatchedUnits: number;
  availableUnits: number;
};

export type RecentLotDispatch = {
  id: number;
  customerName: string;
  orderReference: string;
  invoiceNumber: string;
  productCode: string;
  productName: string;
  orderedQuantityUnits: number;
  dispatchDate: string;
  createdByName: string;
  lots: string;
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
      COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) AS unitsPerPackage,
      COALESCE(p.quantityProduced, 0) AS producedPackages,
      COALESCE(p.quantityProduced, 0) * COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) AS producedUnits,
      COALESCE(outbound.dispatchedUnits, 0) AS dispatchedUnits,
      (
        COALESCE(p.quantityProduced, 0) * COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0)
        - COALESCE(outbound.dispatchedUnits, 0)
      ) AS availableUnits
    FROM Production p
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
    WHERE p.status = 'FINALIZED'
      AND COALESCE(p.quantityProduced, 0) > 0
      AND COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) > 0
      AND (
        COALESCE(p.quantityProduced, 0) * COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0)
        - COALESCE(outbound.dispatchedUnits, 0)
      ) > 0
    ORDER BY p.startedAt ASC, p.id ASC
  `);

  return rows.map((row) => ({
    productionId: Number(row.productionId),
    lotCode: String(row.lotCode),
    productId: Number(row.productId),
    productCode: String(row.productCode),
    productName: String(row.productName),
    machineCode: String(row.machineCode),
    productionDate: String(row.productionDate),
    unitsPerPackage: Number(row.unitsPerPackage),
    producedPackages: Number(row.producedPackages),
    producedUnits: Number(row.producedUnits),
    dispatchedUnits: Number(row.dispatchedUnits),
    availableUnits: Number(row.availableUnits),
  }));
}

export async function getRecentLotDispatches(limit = 30): Promise<RecentLotDispatch[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = await db.query<any[]>(`
    SELECT
      d.id,
      d.customerName,
      d.orderReference,
      d.invoiceNumber,
      pr.code AS productCode,
      pr.name AS productName,
      d.orderedQuantityUnits,
      DATE_FORMAT(d.dispatchDate, '%Y-%m-%d') AS dispatchDate,
      u.name AS createdByName,
      COALESCE(lines.lots, '') AS lots
    FROM LotDispatch d
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
    ) lines ON lines.lotDispatchId = d.id
    WHERE d.cancelledAt IS NULL
    ORDER BY d.dispatchDate DESC, d.id DESC
    LIMIT ${safeLimit}
  `);

  return rows.map((row) => ({
    id: Number(row.id),
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
