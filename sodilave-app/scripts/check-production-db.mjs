// Read-only verification: run with the same DATABASE_URL as the application.
import { columnKey } from "./schema-identifiers.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { query, closeDb } from "./mysql-client.mjs";

try {
  const [server] = await query("SELECT DATABASE() AS databaseName, @@lower_case_table_names AS lowerCaseTableNames");
  const key = (table,column)=>columnKey(table,column,server.lowerCaseTableNames);
  console.log(`Base de dados: ${server.databaseName} (lower_case_table_names=${server.lowerCaseTableNames}).`);
  const columns = await query("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.columns WHERE table_schema=DATABASE()");
  const available = new Set(columns.map(row=>key(row.tableName,row.columnName)));
  const required = {
    WeeklyStartup:["id","status","startupDate","finalizedAt","coolingPump1","coolingPump2"],
    WeeklyShutdown:["weeklyStartupId","status","finalizedAt"],
    Machine:["status","statusChangedAt"],
    MachineEvent:["machineId","occurredAt","toStatus"],
    Production:["recordOrigin","unitsPerPackageSnapshot","productionUnitSnapshot"],
    ProductionStockConsumption:["productionId","rawMaterialLotId","quantityKg"],
    LotDispatch:["cancelledAt","cancelledById","cancelReason","salesOrderItemId","requestId","requestHash"],
    SalesOrder:["id","customerName","orderDate","requestId","requestHash","status"],
    SalesOrderItem:["id","salesOrderId","productId","quantityUnits","unitPrice"],
    StorageLocation:["id","warehouseCode","warehouseName","zoneType","rowNumber","columnNumber","code","active"],
    Product:["productionUnit"],
    MachineCheckup:["oilTempStatus"],
    RawMaterialLot:["manufacturer","supplier"],
    ProductionStorageBalance:["productionId","locationId","quantityPackages"],
    ProductionStorageMovement:["lotDispatchId","movementType","fromLocationId","toLocationId"],
    ShiftPeerConfirmation:["operatorId","shiftStart"],
    User:["sessionVersion"],
    AuthSession:["id","userId","sessionVersion","expiresAt"],
    AuthRateLimit:["bucket","attempts","resetAt"],
    CredentialLock:["id"],
    ProductionDisplayDevice:["id","pairingHash","tokenHash","expiresAt","revokedAt"],
    ProductLotConfig:["productId","majorLetter","minorLetter","version"],
    ProductLotHistory:["productId","scope","previousCode","newCode","reason","changedById"],
    ProductionLotAlias:["productionId","historyId","oldCode","oldLabel"],
    MachineDisplayOrder:["machineId","weeklyStartupId","productId","commercialLotId","destination","notes"],
    OpeningStockRequest:["requestId","requestHash","productionId"],
    HistoricalImportBatch:["fileName","fileHash","importedById"],
    HistoricalImportItem:["productionId","recordKey","contentHash","payloadJson"],
    OperationSettings:["id","pastProductionEnabled","updatedById","updatedAt"],
    ShiftGeneralCheck:["purgePneumaticBarrels","purgeCleanAirBarrels","purgeFilters"],
    AppSchemaMigration:["name","checksum"],
  };
  const missing=Object.entries(required).flatMap(([table,names])=>names.filter(name=>!available.has(key(table,name))).map(name=>`${table}.${name}`));
  if(missing.length)throw new Error(`Estrutura SQL incompleta: ${missing.join(", ")}. Execute npm run db:upgrade nesta pasta com a mesma configuração da aplicação e volte a verificar.`);
  const applied=new Map((await query("SELECT name,checksum FROM AppSchemaMigration")).map(row=>[row.name,row.checksum]));
  const folder=path.join(process.cwd(),"database","migrations");
  for(const name of (await fs.readdir(folder)).filter(name=>name.endsWith(".sql")).sort()) {
    if(!applied.has(name))throw new Error(`Migração pendente: ${name}. Execute npm run db:upgrade nesta pasta.`);
    const checksum=crypto.createHash("sha256").update(await fs.readFile(path.join(folder,name))).digest("hex");
    if(applied.get(name)!==checksum)throw new Error(`A migração ${name} difere da versão aplicada. Reveja a atualização antes de continuar.`);
  }
  console.log("Estrutura operacional e migrações SQL verificadas.");
} catch(error) {
  console.error(error instanceof Error ? error.message : "Falha na verificação SQL.");
  process.exitCode=1;
} finally {
  await closeDb();
}
