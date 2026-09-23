/* Integration tests: real actions and real SQL. Only the Next request session/cache
 * are substituted; run exclusively against a disposable database. */
const {test, before, after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const {execFile}=require('node:child_process');
const execFileAsync=require('node:util').promisify(execFile);
const {createRequire}=require('node:module');
const url=process.env.TEST_DATABASE_URL;
if(!url || !['sodilave_test','typecheck'].includes(new URL(url).pathname.slice(1))) {
  throw new Error('TEST_DATABASE_URL must point to disposable sodilave_test or typecheck database.');
}
process.env.DATABASE_URL=url;
process.env.NODE_ENV='test';
let user;
const cache=new Map();
const root=path.resolve(__dirname,'..');
function load(file) {
  file=path.resolve(root,file);
  if(!path.extname(file))file+='.ts';
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const nativeRequire=createRequire(file);
  const localRequire=(name)=>{
    if(name==='next/cache')return {revalidatePath(){}};
    if(name==='@/lib/auth')return {
      requireOperationalUser:async()=>{if(user.role==='AUDITOR')throw new Error('access-denied');return user;},
      requireAdmin:async()=>{if(user.role!=='ADMIN')throw new Error('access-denied');return user;},
    };
    if(name.startsWith('@/'))return load(name.slice(2));
    if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));
    return nativeRequire(name);
  };
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(localRequire,module,module.exports);
  return module.exports;
}
const {db}=load('lib/db');
const {saveWeeklyStartup}=load('app/actions/startup');
const {saveWeeklyShutdown}=load('app/actions/shutdown');
const {getActiveWeeklyStartup}=load('lib/active-machines');
const {createLotDispatch,cancelLotDispatch}=load('app/actions/lot-dispatch');
const {getAvailableFinishedLots,getRecentLotDispatches}=load('lib/lot-dispatch');
const {getProductionFormData}=load('lib/production-form-data');
const {productionToInitial}=load('lib/production-initial');
const {saveProduction}=load('app/actions/production');
const fd=(obj)=>{const form=new FormData();for(const [key,value]of Object.entries(obj))form.set(key,String(value));return form;};
let machine,product,material,lot,location,production;
before(async()=>{
  const [server]=await db.query('SELECT @@lower_case_table_names AS mode');
  if(process.env.TEST_LOWER_CASE_TABLE_NAMES!==undefined)assert.equal(Number(server.mode),Number(process.env.TEST_LOWER_CASE_TABLE_NAMES));
  // Clean only this explicitly named disposable database, preserving installed schema.
  const tables=await db.query('SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE()');
  await db.$transaction(async tx=>{
    await tx.execute('SET FOREIGN_KEY_CHECKS=0');
    try {for(const {name}of tables)if(name.toLowerCase()!=='appschemamigration')await tx.execute('DELETE FROM `'+name+'`');}
    finally {await tx.execute('SET FOREIGN_KEY_CHECKS=1');}
  });
  user=await db.user.create({data:{name:'Integration admin',pinHash:'test-only',role:'ADMIN'}});
  machine=await db.machine.create({data:{code:'1',name:'Test machine'}});
  product=await db.product.create({data:{code:'TEST',name:'Test product',unitsPerPackage:10}});
  material=await db.rawMaterial.create({data:{code:'TEST',name:'Test material'}});
  lot=await db.rawMaterialLot.create({data:{rawMaterialId:material.id,supplierLot:'TEST',quantityInitial:20,quantityAvailable:20}});
  await db.execute('INSERT INTO ProductMachine (productId,machineId) VALUES (?,?)',[product.id,machine.id]);
  location=await db.storageLocation.create({data:{warehouseCode:'TEST',warehouseName:'Test',zoneType:'STACK',code:'T1',rowNumber:1,columnNumber:1}});
});
after(async()=>{await globalThis.sodilaveMysqlPool.end();});
function startup(intent='finalize',id) {
  const data=fd({intent,coolingPump:"1",machineIds:machine.id,...(id?{startupId:id}:{})});
  for(const key of ['productionWindows','storageWindows','dispatchWindows','forkliftIntegrity','emergencyLighting'])data.set(key,'CONFORMING');
  for(const key of ['acrylics','plasticTrays','lighting','extruderTemperatures','lubrication','mouldCleaning','beltsTraysTables','waterFilters'])data.set(`m${machine.id}_${key}`,'CONFORMING');
  return data;
}
test('upgrade repairs the reported missing-pump-column error and remains repeatable',async()=>{
  const usersBefore=await db.user.count();
  await db.execute('ALTER TABLE WeeklyStartup DROP COLUMN coolingPump1, DROP COLUMN coolingPump2');
  await db.execute('DELETE FROM AppSchemaMigration WHERE name=?',['2026-09-22-shift-confirmation-and-cooling-pumps.sql']);
  await assert.rejects(db.execute('INSERT INTO WeeklyStartup (operatorId,shiftCode,coolingPump1) VALUES (?,?,?)',[user.id,'A',1]),{code:'ER_BAD_FIELD_ERROR'});
  const options={cwd:root,env:{...process.env,DATABASE_URL:url}};
  const check=path.join(root,'scripts/check-production-db.mjs');
  await assert.rejects(execFileAsync(process.execPath,[check],options),error=>{
    assert.match(error.stderr,/WeeklyStartup.coolingPump1/);
    assert.match(error.stderr,/npm run db:upgrade/);
    return true;
  });
  const upgrade=path.join(root,'scripts/prepare-production-db.mjs');
  await execFileAsync(process.execPath,[upgrade],options);
  await execFileAsync(process.execPath,[upgrade],options);
  await execFileAsync(process.execPath,[check],options);
  await db.query('SELECT coolingPump1,coolingPump2 FROM WeeklyStartup');
  assert.equal(await db.user.count(),usersBefore,'upgrade must preserve users');
});
test('stock-map upgrade creates missing positions and preserves existing operational data',async()=>{
  const usersBefore=await db.user.count();
  const lotsBefore=await db.rawMaterialLot.count();
  // Reproduce an installation from before the stock-map migration.
  await db.execute('DROP TABLE ProductionStorageMovement');
  await db.execute('DROP TABLE ProductionStorageBalance');
  await db.execute('DROP TABLE StorageLocation');
  await db.execute('ALTER TABLE Production DROP COLUMN productionUnitSnapshot');
  await db.execute('ALTER TABLE Product DROP COLUMN productionUnit');
  await db.execute('DELETE FROM AppSchemaMigration WHERE name=?',['2026-09-22-stock-map.sql']);
  await assert.rejects(load('lib/stock-map').getStorageLocations(),{code:'ER_NO_SUCH_TABLE'});
  const options={cwd:root,env:{...process.env,DATABASE_URL:url}};
  await assert.rejects(execFileAsync(process.execPath,[path.join(root,'scripts/check-production-db.mjs')],options),error=>{
    assert.match(error.stderr,/StorageLocation.id/);return true;
  });
  await execFileAsync(process.execPath,[path.join(root,'scripts/prepare-production-db.mjs')],options);
  await execFileAsync(process.execPath,[path.join(root,'scripts/check-production-db.mjs')],options);
  const locations=await load('lib/stock-map').getStorageMapData();
  assert.ok(locations.some(row=>row.warehouseCode==='W1'));
  assert.ok(locations.some(row=>row.warehouseCode==='W2'));
  assert.ok(locations.some(row=>row.zoneType==='STACK'));
  assert.ok(locations.some(row=>row.zoneType==='PALLET'));
  assert.ok(locations.every(row=>row.totalPackages===0));
  assert.equal(await db.user.count(),usersBefore);
  assert.equal(await db.rawMaterialLot.count(),lotsBefore);
  location=locations[0];
});
test('schema identifiers follow the server case rules',async()=>{
  const {columnKey,tableNameKey}=await import('../scripts/schema-identifiers.mjs');
  for(const mode of [1,2])assert.equal(columnKey('WeeklyStartup','startupDate',mode),columnKey('weeklystartup','STARTUPDATE',mode));
  assert.notEqual(tableNameKey('WeeklyStartup',0),tableNameKey('weeklystartup',0));
  assert.equal(columnKey('WeeklyStartup','startupDate',0),columnKey('WeeklyStartup','STARTUPDATE',0));
});
test('database scripts load local Next environment files without overriding host settings',async()=>{
  const {pathToFileURL}=require('node:url');
  const tmp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'sodilave-env-'));
  try {
    fs.writeFileSync(path.join(tmp,'.env'),'SODILAVE_TEST_ENV=base\nSODILAVE_TEST_HOST=file\n');
    fs.writeFileSync(path.join(tmp,'.env.local'),'SODILAVE_TEST_ENV=local\n');
    const env={...process.env,NODE_ENV:'development',SODILAVE_TEST_HOST:'host'};
    delete env.SODILAVE_TEST_ENV;delete env.__NEXT_PROCESSED_ENV;
    const code=`await import(${JSON.stringify(pathToFileURL(path.join(root,'scripts/load-env.mjs')).href)}); if(process.env.SODILAVE_TEST_ENV!=='local'||process.env.SODILAVE_TEST_HOST!=='host')process.exit(1);`;
    await execFileAsync(process.execPath,['--input-type=module','-e',code],{cwd:tmp,env});
    fs.writeFileSync(path.join(tmp,'.env.production.local'),'SODILAVE_TEST_ENV=production\n');
    delete env.NODE_ENV;
    await execFileAsync(process.execPath,['--input-type=module','-e',code.replace("!=='local'","!=='production'"),'--','--production'],{cwd:tmp,env});
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
test('weekly startup requires exactly one pump when finalized and rejects both even in drafts',async()=>{
  const missing=startup();missing.delete('coolingPump');
  await assert.rejects(saveWeeklyStartup(missing),/bomba de refrigeração em funcionamento/);
  for(const intent of ['draft','finalize']) {
    const both=startup(intent);both.delete('coolingPump');both.set('coolingPump1','on');both.set('coolingPump2','on');
    await assert.rejects(saveWeeklyStartup(both),/simultâneo/);
  }
  const duplicate=startup();duplicate.append('coolingPump','2');
  await assert.rejects(saveWeeklyStartup(duplicate),/apenas uma/);
  const draftForm=startup('draft');draftForm.delete('coolingPump');
  const draft=await saveWeeklyStartup(draftForm);
  const changed=startup('draft',draft.id);changed.set('coolingPump','2');
  await saveWeeklyStartup(changed);
  const record=await db.weeklyStartup.findUnique({where:{id:draft.id}});
  assert.equal(Number(record.coolingPump1),0);assert.equal(Number(record.coolingPump2),1);
  await db.weeklyStartupMachine.deleteMany({where:{weeklyStartupId:draft.id}});
  await db.weeklyStartup.delete({where:{id:draft.id}});
});
test('weekly draft → finalization → shutdown draft remains active → next cycle',async()=>{
  const draft=await saveWeeklyStartup(startup('draft'));
  assert.equal(await getActiveWeeklyStartup(),null);
  const final=await saveWeeklyStartup(startup('finalize',draft.id));
  assert.equal(final.id,draft.id);
  const pumpRecord=await db.weeklyStartup.findUnique({where:{id:final.id}});
  assert.equal(Number(pumpRecord.coolingPump1),1);assert.equal(Number(pumpRecord.coolingPump2),0);
  assert.equal((await getActiveWeeklyStartup()).id,draft.id);
  assert.equal((await db.machine.findUnique({where:{id:machine.id}})).status,'RUNNING');
  const stop=await saveWeeklyShutdown(fd({intent:'draft'}));
  assert.equal((await getActiveWeeklyStartup()).id,draft.id);
  await assert.rejects(saveWeeklyStartup(startup()),/paragem semanal/);
  await db.machine.update({where:{id:machine.id},data:{status:"STOPPED"}});
  await saveWeeklyShutdown(fd({shutdownId:stop.id,intent:'finalize',observations:'Integration check'}));
  assert.equal(await getActiveWeeklyStartup(),null);
  assert.equal((await db.machine.findUnique({where:{id:machine.id}})).status,'STOPPED');
  const attempts=await Promise.allSettled([saveWeeklyStartup(startup()),saveWeeklyStartup(startup())]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1,'concurrent requests must not open two cycles');
  assert.equal(await db.weeklyStartup.count({where:{status:'FINALIZED'}}),2);
});
test('finalized correction includes depleted lots, preserves booked quantities and snapshots',async()=>{
  production=await db.production.create({data:{machineId:machine.id,productId:product.id,operatorId:user.id,productionLot:'TEST-LOT',shiftCode:'A',status:'FINALIZED',quantityProduced:4,initialWeightG:100,midWeightG:100,unitsPerPackageSnapshot:10,productionUnitSnapshot:'BAG'}});
  await db.productionMaterial.create({data:{productionId:production.id,rawMaterialLotId:lot.id,percentage:100,quantityKg:20}});
  await db.execute('INSERT INTO ProductionStockConsumption (productionId,rawMaterialLotId,quantityKg) VALUES (?,?,?)',[production.id,lot.id,20]);
  await db.rawMaterialLot.update({where:{id:lot.id},data:{status:'DEPLETED',quantityAvailable:0}});
  await db.product.update({where:{id:product.id},data:{unitsPerPackage:99}});
  await db.productionStorageBalance.create({data:{productionId:production.id,locationId:location.id,quantityPackages:4}});
  const data=await getProductionFormData({existingProductionId:production.id,currentUserId:user.id});
  assert.equal(Number(data.lots.find(row=>row.id===lot.id).quantityEditable),20);
  assert.equal(Number(data.lots.find(row=>row.id===lot.id).quantityAvailable),0);
  assert.equal(data.products.find(row=>row.id===product.id).unitsPerPackage,10);
  const record=await db.production.findUnique({where:{id:production.id},include:{materials:{include:{rawMaterialLot:true}},tests:true}});
  assert.equal(productionToInitial(record).materials[0].manualQuantity,true);
  // Create the required commercial-lot recipe, then run the actual save action.
  await db.execute("INSERT INTO CommercialLot (code,productId,status,createdById) VALUES ('TEST-COMMERCIAL',?,'ACTIVE',?)",[product.id,user.id]);
  const [commercial]=await db.query("SELECT id FROM CommercialLot WHERE code='TEST-COMMERCIAL'");
  await db.execute('INSERT INTO CommercialLotMaterial (commercialLotId,rawMaterialId,percentage) VALUES (?,?,100)',[commercial.id,material.id]);
  const correction=fd({productionId:production.id,intent:'finalize',machineId:machine.id,productId:product.id,quantityProduced:4,initialWeightG:100,midWeightG:100,materialLotId_0:lot.id,percentage_0:100,quantityKg_0:20,leakStart:'CONFORMING',leakMid:'CONFORMING',dropStart:'CONFORMING',dropMid:'CONFORMING'});
  await saveProduction(correction);
  assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),0);
  assert.equal((await db.production.findUnique({where:{id:production.id}})).unitsPerPackageSnapshot,10);
  correction.set('quantityKg_0','21');
  await assert.rejects(saveProduction(correction),/consumo adicional|stock disponível/);
  assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),0);
});
test('dispatch cancellation restores exactly once, keeps history and requires admin',async()=>{
  const dispatch=await createLotDispatch(fd({customerName:'Test customer',orderReference:'Test order',invoiceNumber:'Test invoice',dispatchDate:'2026-09-01',productId:product.id,orderedQuantityUnits:40,[`stock_${production.id}_${location.id}`]:4}));
  assert.equal((await getAvailableFinishedLots()).length,0);
  const cancel=fd({dispatchId:dispatch.id,reason:'Correction test'});
  user.role='OPERATOR';
  await assert.rejects(cancelLotDispatch(cancel),/access-denied/);
  user.role='ADMIN';
  const attempts=await Promise.allSettled([cancelLotDispatch(cancel),cancelLotDispatch(cancel)]);
  assert.equal(attempts.filter(row=>row.status==='fulfilled').length,1);
  const available=await getAvailableFinishedLots();
  assert.equal(available[0].availablePackages,4);
  assert.equal(available[0].availableUnits,40);
  assert.equal(available[0].dispatchedUnits,0);
  const history=await getRecentLotDispatches();
  assert.ok(history[0].cancelledAt);
  assert.equal(history[0].cancelReason,'Correction test');
  assert.equal(await db.productionStorageMovement.count({where:{lotDispatchId:dispatch.id,movementType:'DISPATCH_REVERSAL'}}),1);
});
test('invalid dispatch rolls back and cancelled production cannot regain finished stock',async()=>{
  const count=await db.lotDispatch.count();
  await assert.rejects(createLotDispatch(fd({customerName:'Test',orderReference:'Invalid',invoiceNumber:'Invalid',dispatchDate:'2026-09-01',productId:product.id,orderedQuantityUnits:50,[`stock_${production.id}_${location.id}`]:5})),/disponíveis/);
  assert.equal(await db.lotDispatch.count(),count);
  assert.equal((await getAvailableFinishedLots())[0].availablePackages,4);
  await load('app/actions/production-admin').cancelProduction(fd({id:production.id}));
  assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),20);
  assert.equal((await getAvailableFinishedLots()).length,0);
  await assert.rejects(load('app/actions/stock-map').addUnlocatedStock(fd({productionId:production.id,locationId:location.id,quantityPackages:1,reason:'Must fail'})),/finalizadas/);
  assert.equal((await getAvailableFinishedLots()).length,0);
});

test('past production is globally gated for admins and operators, including old drafts and direct requests',async()=>{
  const {saveOperationSettings}=load('app/actions/operation-settings');
  const {getPastProductionEnabled}=load('lib/operation-settings');
  const {getShiftWindow,formatLocalDateInput}=load('lib/shift');
  assert.equal(await getPastProductionEnabled(),false);
  const day=new Date();day.setDate(day.getDate()-2);
  const input=fd({intent:'draft',machineId:machine.id,productId:product.id,historicalDate:formatLocalDateInput(day),historicalShift:'A'});
  await assert.rejects(saveProduction(input),/desativado/);
  user.role='OPERATOR';
  await assert.rejects(saveOperationSettings(fd({pastProductionEnabled:'on'})),/access-denied/);
  await assert.rejects(saveProduction(input),/desativado/);
  user.role='ADMIN';await saveOperationSettings(fd({pastProductionEnabled:'on'}));
  assert.equal(await getPastProductionEnabled(),true);
  await db.machine.update({where:{id:machine.id},data:{status:'STOPPED'}});
  user.role='OPERATOR';
  const attempts=await Promise.allSettled([saveProduction(input),saveProduction(input)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1,'past-shift duplicates must be serialized');
  const saved=attempts.find(r=>r.status==='fulfilled').value;
  const row=await db.production.findUnique({where:{id:saved.id}});
  assert.equal(formatLocalDateInput(row.startedAt),formatLocalDateInput(day));
  assert.equal(row.shiftCode,'A');assert.equal(row.operatorId,user.id);
  input.set('productionId',String(saved.id));
  await saveProduction(input);
  input.set('historicalShift','B');
  await assert.rejects(saveProduction(input),/não podem ser alterados/);
  input.set('historicalDate',formatLocalDateInput());input.set('historicalShift',getShiftWindow().code);
  await assert.rejects(saveProduction(input),/já terminado/);
  user.role='ADMIN';await saveOperationSettings(fd({}));
  // Omitting the hidden date/shift must not bypass the global switch.
  input.delete('historicalDate');input.delete('historicalShift');
  await assert.rejects(saveProduction(input),/desativado/);
  user.role='OPERATOR';await assert.rejects(saveProduction(input),/desativado/);
  user.role='AUDITOR';await assert.rejects(saveProduction(input),/access-denied/);
  user.role='ADMIN';
  await db.machine.update({where:{id:machine.id},data:{status:'RUNNING'}});
});

test('shift checkups save atomically with one peer confirmation at the end and all three purges',async()=>{
  const {saveShiftCheckups}=load('app/actions/checkups');
  const {getShiftWindow}=load('lib/shift');
  const secondMachine=await db.machine.create({data:{code:'2',name:'Second test machine',status:'RUNNING'}});
  const peer=await db.user.create({data:{name:'Second worker',role:'OPERATOR',pinHash:await require('bcryptjs').hash('12345678',4)}});
  await db.user.update({where:{id:user.id},data:{role:'OPERATOR'}});user.role='OPERATOR';
  const input=fd({intent:'draft',shiftStart:getShiftWindow().start.toISOString(),chillerLargeC:5,chillerSmallC:6,ambientTempC:22,purgePneumaticBarrels:'on',purgeCleanAirBarrels:'on',purgeFilters:'on'});
  for(const m of [machine,secondMachine]) {
    input.append('machineIds',String(m.id));
    for(const [key,value]of Object.entries({oilTempC:40,oilLevel:'NORMAL',waterPressure:3,airPressure:6}))input.set(`m${m.id}_${key}`,String(value));
  }
  try {
    const draft=await saveShiftCheckups(input);
    assert.equal(draft.finalized,false);
    assert.equal((await db.query('SELECT * FROM ShiftPeerConfirmation')).length,0,'drafts do not require a peer');
    input.set('generalId',String(draft.general.id));
    for(const m of draft.machines)input.set(`m${m.machineId}_checkupId`,String(m.id));
    input.set('intent','finalize');input.set('secondWorkerId',String(peer.id));input.set('secondWorkerPin','12345678');
    input.delete(`m${secondMachine.id}_oilTempC`);
    await assert.rejects(saveShiftCheckups(input),/Máquina 2/);
    assert.equal((await db.shiftGeneralCheck.findUnique({where:{id:draft.general.id}})).status,'DRAFT','general write rolls back');
    assert.equal((await db.machineCheckup.findUnique({where:{id:draft.machines[0].id}})).status,'DRAFT','first machine rolls back');
    assert.equal((await db.query('SELECT * FROM ShiftPeerConfirmation')).length,0,'confirmation rolls back with invalid checks');
    assert.equal((await db.query('SELECT * FROM RecordConfirmation')).length,0);
    input.set(`m${secondMachine.id}_oilTempC`,'42');
    const final=await saveShiftCheckups(input);
    assert.equal(final.finalized,true);assert.equal(final.general.id,draft.general.id);
    assert.equal((await db.query('SELECT * FROM ShiftPeerConfirmation')).length,1);
    assert.equal((await db.query("SELECT * FROM RecordConfirmation WHERE entity IN ('ShiftGeneralCheck','MachineCheckup')")).length,3);
    const general=await db.shiftGeneralCheck.findUnique({where:{id:draft.general.id}});
    for(const key of ['purgePneumaticBarrels','purgeCleanAirBarrels','purgeFilters'])assert.equal(Number(general[key]),1);
    // Re-submit without PIN and without IDs: reuse this shift's rows, no duplicates.
    input.delete('secondWorkerId');input.delete('secondWorkerPin');input.delete('generalId');
    for(const m of final.machines)input.delete(`m${m.machineId}_checkupId`);
    await saveShiftCheckups(input);
    assert.equal(await db.shiftGeneralCheck.count(),1);assert.equal(await db.machineCheckup.count(),2);
    input.set('machineIds',String(machine.id));
    await assert.rejects(saveShiftCheckups(input),/máquinas em funcionamento mudaram/);
    input.set('shiftStart','2000-01-01T00:00:00.000Z');
    await assert.rejects(saveShiftCheckups(input),/turno mudou/);
  } finally {user.role='ADMIN';await db.user.update({where:{id:user.id},data:{role:'ADMIN'}});}
});

test('dashboard includes all seven machines in numeric order',async()=>{
  for(const code of ['3','4','5','6','7'])await db.machine.create({data:{code,name:`Máquina ${code}`}});
  const data=await load('lib/admin-dashboard').getAdminDashboardData(new Date());
  assert.deepEqual(data.uptime.map(m=>m.code),['1','2','3','4','5','6','7']);
});

test('an authorized operator can finalize a past production and book stock in its original shift',async()=>{
  const {saveOperationSettings}=load('app/actions/operation-settings');
  const {formatLocalDateInput}=load('lib/shift');
  const row=await db.production.findFirst({where:{status:'DRAFT',machineId:machine.id}});
  assert.ok(row);
  await saveOperationSettings(fd({pastProductionEnabled:'on'}));
  await db.user.update({where:{id:user.id},data:{role:'OPERATOR'}});user.role='OPERATOR';
  await db.machine.update({where:{id:machine.id},data:{status:'STOPPED'}});
  const before=Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable);
  try {
    const result=await saveProduction(fd({productionId:row.id,intent:'finalize',machineId:machine.id,productId:product.id,
      historicalDate:formatLocalDateInput(row.startedAt),historicalShift:'A',quantityProduced:1,initialWeightG:100,midWeightG:100,
      materialLotId_0:lot.id,percentage_0:100,quantityKg_0:1,storageUnlocated:'on',
      leakStart:'CONFORMING',leakMid:'CONFORMING',dropStart:'CONFORMING',dropMid:'CONFORMING'}));
    assert.equal(result.id,row.id);
    const saved=await db.production.findUnique({where:{id:row.id}});
    assert.equal(saved.status,'FINALIZED');assert.equal(saved.startedAt.getTime(),row.startedAt.getTime());
    assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),before-1);
    assert.equal((await db.query("SELECT * FROM RecordConfirmation WHERE entity='Production' AND entityId=?",[row.id])).length,1);
  } finally {user.role='ADMIN';await db.user.update({where:{id:user.id},data:{role:'ADMIN'}});}
});
