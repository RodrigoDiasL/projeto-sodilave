// Read-only verification: run with the same DATABASE_URL as the application.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { query, closeDb } from "./mysql-client.mjs";

try {
  const columns = await query("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.columns WHERE table_schema=DATABASE()");
  const available = new Set(columns.map(row=>`${row.tableName}.${row.columnName}`));
  const required = {
    WeeklyStartup:["id","status","startupDate","finalizedAt","coolingPump1","coolingPump2"],
    WeeklyShutdown:["weeklyStartupId","status","finalizedAt"],
    Machine:["status","statusChangedAt"],
    MachineEvent:["machineId","occurredAt","toStatus"],
    Production:["unitsPerPackageSnapshot","productionUnitSnapshot"],
    ProductionStockConsumption:["productionId","rawMaterialLotId","quantityKg"],
    LotDispatch:["cancelledAt","cancelledById","cancelReason"],
    ProductionStorageBalance:["productionId","locationId","quantityPackages"],
    ProductionStorageMovement:["lotDispatchId","movementType","fromLocationId","toLocationId"],
    ShiftPeerConfirmation:["operatorId","shiftStart"],
    AppSchemaMigration:["name","checksum"],
  };
  const missing=Object.entries(required).flatMap(([table,names])=>names.map(name=>`${table}.${name}`)).filter(name=>!available.has(name));
  if(missing.length)throw new Error(`Estrutura SQL incompleta: ${missing.join(", ")}. Execute npm run db:production com as variáveis do servidor e volte a verificar.`);
  const applied=new Map((await query("SELECT name,checksum FROM AppSchemaMigration")).map(row=>[row.name,row.checksum]));
  const folder=path.join(process.cwd(),"database","migrations");
  for(const name of (await fs.readdir(folder)).filter(name=>name.endsWith(".sql")).sort()) {
    if(!applied.has(name))throw new Error(`Migração pendente: ${name}. Execute npm run db:production.`);
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
