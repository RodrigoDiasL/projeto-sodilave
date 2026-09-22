"import { db } from \"@/lib/db\";

export type StorageZoneType = \"STACK\" | \"PALLET\";
export type ProductionUnit = \"BAG\" | \"PALLET\";

export type StorageLocationInfo = {
  id: number;
  warehouseCode: \"W1\" | \"W2\";
  warehouseName: string;
  zoneType: StorageZoneType;
  rowNumber: number;
  columnNumber: number;
  code: string;
};

export type StoredLotLine = {
  productionId: number;
  lotCode: string;
  productId: number;
  productCode: string;
  productName: string;
  productionUnit: ProductionUnit;
  unitsPerPackage: number;
  quantityPackages: number;
  quantityUnits: number;
};

export type StorageMapLocation = StorageLocationInfo & {
  totalPackages: number;
  lotCount: number;
  lots: StoredLotLine[];
};

export type UnlocatedFinishedLot = {
  productionId: number;
  lotCode: string;
  productCode: string;
  productName: string;
  productionUnit: ProductionUnit;
  unitsPerPackage: number;
  producedPackages: number;
  dispatchedPackages: number;
  locatedPackages: number;
  missingPackages: number;
};

export async function getStorageLocations(): Promise<StorageLocationInfo[]> {
  const rows = await db.query<any[]>(\`
    SELECT id, warehouseCode, warehouseName, zoneType, rowNumber, columnNumber, code
    FROM StorageLocation
    WHERE active = 1
    ORDER BY warehouseCode, FIELD(zoneType,'STACK','PALLET'), rowNumber, columnNumber
  \`);
  return rows.map((row) => ({
    id: Number(row.id),
    warehouseCode: String(row.warehouseCode) as \"W1\" | \"W2\",
    warehouseName: String(row.warehouseName),
    zoneType: String(row.zoneType) as StorageZoneType,
    rowNumber: Number(row.rowNumber),
    columnNumber: Number(row.columnNumber),
    code: String(row.code),
  }));
}

export async function getStorageMapData(): Promise<StorageMapLocation[]> {
  const [locations, rows] = await Promise.all([
    getStorageLocations(),
    db.query<any[]>(\`
      SELECT
        b.locationId,
        b.productionId,
        b.quantityPackages,
        COALESCE(pla.labelCode, p.productionLot) AS lotCode,
        p.productId,
        pr.code AS productCode,
        pr.name AS productName,
        COALESCE(p.productionUnitSnapshot, pr.productionUnit, 'BAG') AS productionUnit,
        COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) AS unitsPerPackage
      FROM ProductionStorageBalance b
      INNER JOIN Production p ON p.id = b.productionId
      INNER JOIN Product pr ON pr.id = p.productId
      LEFT JOIN ProductionLotAssociation pla ON pla.productionId = p.id
      WHERE b.quantityPackages > 0
      ORDER BY p.startedAt ASC, p.id ASC
    \`),
  ]);

  const byLocation = new Map<number, StoredLotLine[]>();
  for (const row of rows) {
    const list = byLocation.get(Number(row.locationId)) ?? [];
    const quantityPackages = Number(row.quantityPackages);
    const unitsPerPackage = Number(row.unitsPerPackage);
    list.push({
      productionId: Number(row.productionId),
      lotCode: String(row.lotCode),
      productId: Number(row.productId),
      productCode: String(row.productCode),
      productName: String(row.productName),
      productionUnit: String(row.productionUnit || \"BAG\") as ProductionUnit,
      unitsPerPackage,
      quantityPackages,
      quantityUnits: quantityPackages * unitsPerPackage,
    });
    byLocation.set(Number(row.locationId), list);
  }

  return locations.map((location) => {
    const lots = byLocation.get(location.id) ?? [];
    return {
      ...location,
      lots,
      lotCount: lots.length,
      totalPackages: lots.reduce((sum, lot) => sum + lot.quantityPackages, 0),
    };
  });
}

export async function getProductionStorageBalances(productionId: number) {
  const rows = await db.query<any[]>(\`
    SELECT
      b.locationId,
      b.quantityPackages,
      l.warehouseCode,
      l.warehouseName,
      l.zoneType,
      l.rowNumber,
      l.columnNumber,
      l.code
    FROM ProductionStorageBalance b
    INNER JOIN StorageLocation l ON l.id = b.locationId
    WHERE b.productionId = ?
      AND b.quantityPackages > 0
    ORDER BY l.warehouseCode, FIELD(l.zoneType,'STACK','PALLET'), l.rowNumber, l.columnNumber
  \`, [productionId]);

  return rows.map((row) => ({
    locationId: Number(row.locationId),
    quantityPackages: Number(row.quantityPackages),
    warehouseCode: String(row.warehouseCode),
    warehouseName: String(row.warehouseName),
    zoneType: String(row.zoneType) as StorageZoneType,
    rowNumber: Number(row.rowNumber),
    columnNumber: Number(row.columnNumber),
    code: String(row.code),
  }));
}

export async function getUnlocatedFinishedLots(): Promise<UnlocatedFinishedLot[]> {
  const rows = await db.query<any[]>(\`
    SELECT
      p.id AS productionId,
      COALESCE(pla.labelCode, p.productionLot) AS lotCode,
      pr.code AS productCode,
      pr.name AS productName,
      COALESCE(p.productionUnitSnapshot, pr.productionUnit, 'BAG') AS productionUnit,
      COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) AS unitsPerPackage,
      COALESCE(p.quantityProduced, 0) AS producedPackages,
      COALESCE(storage.locatedPackages, 0) AS locatedPackages,
      COALESCE(outbound.dispatchedUnits, 0) AS dispatchedUnits
    FROM Production p
    INNER JOIN Product pr ON pr.id = p.productId
    LEFT JOIN ProductionLotAssociation pla ON pla.productionId = p.id
    LEFT JOIN (
      SELECT productionId, SUM(quantityPackages) AS locatedPackages
      FROM ProductionStorageBalance
      GROUP BY productionId
    ) storage ON storage.productionId = p.id
    LEFT JOIN (
      SELECT line.productionId, SUM(line.quantityUnits) AS dispatchedUnits
      FROM LotDispatchLine line
      INNER JOIN LotDispatch d ON d.id = line.lotDispatchId
      WHERE d.cancelledAt IS NULL
      GROUP BY line.productionId
    ) outbound ON outbound.productionId = p.id
    WHERE p.status = 'FINALIZED'
      AND COALESCE(p.quantityProduced, 0) > 0
      AND COALESCE(p.unitsPerPackageSnapshot, pr.unitsPerPackage, 0) > 0
    ORDER BY p.startedAt DESC, p.id DESC
  \`);

  return rows.flatMap((row) => {
    const unitsPerPackage = Number(row.unitsPerPackage);
    const producedPackages = Number(row.producedPackages);
    const dispatchedUnits = Number(row.dispatchedUnits);
    const dispatchedPackages = unitsPerPackage > 0 ? dispatchedUnits / unitsPerPackage : 0;
    const locatedPackages = Number(row.locatedPackages);
    const missingPackages = producedPackages - dispatchedPackages - locatedPackages;
    if (!Number.isInteger(dispatchedPackages) || missingPackages <= 0) return [];
    return [{
      productionId: Number(row.productionId),
      lotCode: String(row.lotCode),
      productCode: String(row.productCode),
      productName: String(row.productName),
      productionUnit: String(row.productionUnit || \"BAG\") as ProductionUnit,
      unitsPerPackage,
      producedPackages,
      dispatchedPackages,
      locatedPackages,
      missingPackages,
    }];
  });
}
"