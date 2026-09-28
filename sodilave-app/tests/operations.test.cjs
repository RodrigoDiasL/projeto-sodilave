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
const testCookies=new Map();
const cookieOptions=new Map();
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
    if(name==='next/headers')return {
      cookies:async()=>({get:name=>testCookies.has(name)?{value:testCookies.get(name)}:undefined,set:(name,value,options)=>{testCookies.set(name,value);cookieOptions.set(name,options);},delete:name=>testCookies.delete(name)}),
      headers:async()=>new Headers(),
    };
    if(name==='next/navigation')return {redirect:location=>{throw new Error('redirect:'+location);}};
    if(name==='@/lib/auth')return {
      requireUser:async()=>{if(!user)throw new Error('access-denied');return user;},
      requireOperationalUser:async()=>{if(!user||!['ADMIN','OPERATOR','PRODUCTION_MANAGER','LOGISTICS'].includes(user.role))throw new Error('access-denied');return user;},
      requireCommerceUser:async()=>{if(!user||!['ADMIN','PRODUCTION_MANAGER','LOGISTICS'].includes(user.role))throw new Error('access-denied');return user;},
      requireCommerceReadAccess:async()=>{if(!user||!['ADMIN','PRODUCTION_MANAGER','LOGISTICS','AUDITOR'].includes(user.role))throw new Error('access-denied');return user;},
      requireAdmin:async()=>{if(!user||user.role!=='ADMIN')throw new Error('access-denied');return user;},
      requireProductionManager:async()=>{if(!user||!['ADMIN','PRODUCTION_MANAGER'].includes(user.role))throw new Error('access-denied');return user;},
      createSession:(...args)=>load('lib/auth').createSession(...args),
      destroySession:(...args)=>load('lib/auth').destroySession(...args),
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
const {createLotDispatch:dispatchFromOrder,cancelLotDispatch}=load('app/actions/lot-dispatch');
const {getAvailableFinishedLots,getRecentLotDispatches}=load('lib/lot-dispatch');
const {getProductionFormData}=load('lib/production-form-data');
const {productionToInitial}=load('lib/production-initial');
const {saveProduction}=load('app/actions/production');
const fd=(obj)=>{const form=new FormData();for(const [key,value]of Object.entries(obj))form.set(key,String(value));return form;};
// Existing stock regression scenarios now create a registered customer order.
async function createLotDispatch(form) {
  if(!form.has('salesOrderItemId')) {
    const order=await load('app/actions/sales-orders').createSalesOrder(fd({customerName:form.get('customerName'),customerReference:form.get('orderReference'),orderDate:form.get('dispatchDate'),requestId:require('node:crypto').randomUUID(),items:JSON.stringify([{productId:Number(form.get('productId')),quantityUnits:Number(form.get('orderedQuantityUnits')),unitPrice:'1.00'}])}));
    const [item]=await db.query('SELECT id FROM SalesOrderItem WHERE salesOrderId=?',[order.id]);
    form.set('salesOrderItemId',String(item.id));form.set('requestId',require('node:crypto').randomUUID());
  }
  return dispatchFromOrder(form);
}
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
  await db.execute('INSERT INTO CredentialLock (id) VALUES (1)');
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

test('new past production is globally gated while saved drafts can be completed in their original shift',async()=>{
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
  // A saved draft remains continuable even when creation of past records is disabled.
  input.delete('historicalDate');input.delete('historicalShift');
  assert.equal((await saveProduction(input)).id,saved.id);
  user.role='OPERATOR';assert.equal((await saveProduction(input)).id,saved.id);
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
    for(const [key,value]of Object.entries({oilTempStatus:'NORMAL',oilLevel:'NORMAL',waterPressure:3,airPressure:6}))input.set(`m${m.id}_${key}`,String(value));
  }
  try {
    const draft=await saveShiftCheckups(input);
    assert.equal(draft.finalized,false);
    assert.equal((await db.query('SELECT * FROM ShiftPeerConfirmation')).length,0,'drafts do not require a peer');
    input.set('generalId',String(draft.general.id));
    for(const m of draft.machines)input.set(`m${m.machineId}_checkupId`,String(m.id));
    input.set('intent','finalize');input.set('secondWorkerId',String(peer.id));input.set('secondWorkerPin','12345678');
    input.delete(`m${secondMachine.id}_oilTempStatus`);
    await assert.rejects(saveShiftCheckups(input),/Máquina 2/);
    assert.equal((await db.shiftGeneralCheck.findUnique({where:{id:draft.general.id}})).status,'DRAFT','general write rolls back');
    assert.equal((await db.machineCheckup.findUnique({where:{id:draft.machines[0].id}})).status,'DRAFT','first machine rolls back');
    assert.equal((await db.query('SELECT * FROM ShiftPeerConfirmation')).length,0,'confirmation rolls back with invalid checks');
    assert.equal((await db.query('SELECT * FROM RecordConfirmation')).length,0);
    input.set(`m${secondMachine.id}_oilTempStatus`,'HOT');
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

test('every operational mutation rejects anonymous users and auditors; admin mutations reject operators',async()=>{
  const account=user;
  const operational=['startup','shutdown','checkups','production','lot-dispatch','incidents','intermediate-startup','maintenance','sales-orders','stock-map','production-display','operation-settings','production-admin','admin','historical-import','product-variants'];
  try {
    for(const role of [null,'AUDITOR']) {
      user=role?{...account,role}:null;
      for(const file of operational)for(const action of Object.values(load(`app/actions/${file}`))) {
        if(typeof action==='function')await assert.rejects(action(new FormData()),/access-denied/,`${file}: ${role??'anonymous'}`);
      }
    }
    user={...account,role:'OPERATOR'};
    for(const file of ['sales-orders','lot-dispatch','stock-map','production-display','operation-settings','production-admin','admin','maintenance','historical-import','product-variants'])for(const action of Object.values(load(`app/actions/${file}`))) {
      if(typeof action==='function')await assert.rejects(action(new FormData()),/access-denied/,`${file}: operator`);
    }
    for(const role of ['OPERATOR','AUDITOR']) {
      user={...account,role};
      for(const action of Object.values(load('app/actions/lots')))await assert.rejects(action(new FormData()),/permissão/);
    }
  } finally {user=account;}
});

test('authentication attempts are atomic, persist across rollbacks and expire',async()=>{
  const {reserveAuthAttempt}=load('lib/auth-rate-limit');
  const results=await Promise.allSettled(Array.from({length:12},()=>reserveAuthAttempt('test:concurrent',4)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,4);
  assert.equal(results.filter(r=>r.status==='rejected').length,8);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>/Demasiadas tentativas/.test(r.reason.message)));
  await db.execute("UPDATE AuthRateLimit SET resetAt=DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE bucket='test:concurrent'");
  await reserveAuthAttempt('test:concurrent',4);
  const [row]=await db.query("SELECT attempts FROM AuthRateLimit WHERE bucket='test:concurrent'");
  assert.equal(row.attempts,1);
});

test('login uses a shared budget and revocable sessions; PIN changes reject replay and obsolete credentials',async()=>{
  const auth=load('lib/auth');
  const {loginAction,logoutAction}=load('app/actions/auth');
  const pin='87654321';
  const pinHash=await require('bcryptjs').hash(pin,4);
  await db.user.update({where:{id:user.id},data:{pinHash}});
  await db.execute("DELETE FROM AuthRateLimit WHERE bucket LIKE 'login:%'");
  await assert.rejects(loginAction(undefined,fd({pin})),/redirect:\/dashboard/);
  const token=testCookies.get('sodilave_session');
  assert.ok(token);
  assert.equal(cookieOptions.get('sodilave_session').httpOnly,true);
  assert.equal(cookieOptions.get('sodilave_session').sameSite,'lax');
  const session=await auth.getSession();
  assert.equal(session.id,user.id);assert.equal('pinHash' in session,false);
  await assert.rejects(logoutAction(),/redirect:\/login/);
  testCookies.set('sodilave_session',token);
  assert.equal(await auth.getSession(),null,'logging out invalidates a copied token');
  await assert.rejects(loginAction(undefined,fd({pin})),/redirect:\/dashboard/);
  const activeToken=testCookies.get('sodilave_session');
  const {updateUser}=load('app/actions/admin');
  await updateUser(fd({id:user.id,name:user.name,role:'ADMIN',active:'on',pin:'11223344'}));
  testCookies.set('sodilave_session',activeToken);
  assert.equal(await auth.getSession(),null,'PIN reset revokes open sessions');
  await assert.rejects(auth.createSession({userId:user.id,name:user.name,role:'ADMIN'},pinHash),/credenciais foram alteradas/);
  await db.execute("INSERT INTO AuthRateLimit (bucket,attempts,resetAt) VALUES ('login:global',30,TIMESTAMPADD(SECOND,60,NOW(3))) ON DUPLICATE KEY UPDATE attempts=30,resetAt=VALUES(resetAt)");
  const blocked=await loginAction(undefined,fd({pin:'11223344'}));
  assert.match(blocked.error,/Demasiadas tentativas/);
  testCookies.set('sodilave_session','not-a-valid-token');
  assert.equal(await auth.getSession(),null);
});

test('duplicate PIN creation is serialized and PINs are not silently truncated',async()=>{
  const {createUser}=load('app/actions/admin');
  await assert.rejects(createUser(fd({name:'Bad PIN',role:'OPERATOR',pin:'123456789'})),/exatamente 8/);
  const results=await Promise.allSettled([
    createUser(fd({name:'Concurrent A',role:'OPERATOR',pin:'45678901'})),
    createUser(fd({name:'Concurrent B',role:'OPERATOR',pin:'45678901'})),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
});

test('SQL values remain data with NO_BACKSLASH_ESCAPES; empty single-record filters are rejected',async()=>{
  await db.$transaction(async tx=>{
    await tx.execute("SET SESSION sql_mode=CONCAT(@@sql_mode,',NO_BACKSLASH_ESCAPES')");
    try {
      const payload="x' OR 1=1 -- ";
      const rows=await tx.query('SELECT id FROM User WHERE name=?',[payload]);
      assert.equal(rows.length,0);
      const [literal]=await tx.query('SELECT ? AS value',[payload]);
      assert.equal(literal.value,payload);
    } finally {await tx.execute("SET SESSION sql_mode=REPLACE(@@sql_mode,'NO_BACKSLASH_ESCAPES','')");}
  });
  const before=await db.user.count();
  await assert.rejects(db.user.update({where:{id:undefined},data:{active:false}}),/identificador explícito/);
  await assert.rejects(db.user.delete({where:{}}),/identificador explícito/);
  assert.equal(await db.user.count(),before);
});

test('intermediate startup is serialized and incident times cannot falsify machine history',async()=>{
  const {registerIntermediateStartup}=load('app/actions/intermediate-startup');
  const {registerIncident}=load('app/actions/incidents');
  await db.machine.update({where:{id:machine.id},data:{status:'STOPPED'}});
  const input=fd({machineId:machine.id,reason:'Security concurrency test'});
  const result=await Promise.allSettled([registerIntermediateStartup(input),registerIntermediateStartup(input)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const tomorrow=new Date(Date.now()+86400000).toISOString();
  await assert.rejects(registerIncident(fd({machineId:machine.id,description:'Invalid future stop',stoppedMachine:'on',occurredAt:tomorrow})),/não pode estar no futuro/);
  assert.equal((await db.machine.findUnique({where:{id:machine.id}})).status,'RUNNING');
});

test('normal production cannot be duplicated by simultaneous drafts or reassigned to a different machine',async()=>{
  const input=fd({intent:'draft',machineId:machine.id,productId:product.id});
  const results=await Promise.allSettled([saveProduction(input),saveProduction(input)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const row=results.find(r=>r.status==='fulfilled').value;
  input.set('productionId',String(row.id));
  const other=await db.machine.findFirst({where:{code:'2'}});input.set('machineId',String(other.id));
  await assert.rejects(saveProduction(input),/máquina.*não pode ser alterada/);
  await load('app/actions/production-admin').cancelProduction(fd({id:row.id}));
});

test('invalid product configuration leaves prior data intact',async()=>{
  const {createProduct,updateProduct}=load('app/actions/admin');
  const count=await db.product.count();
  await assert.rejects(createProduct(fd({code:'INVALID',name:'Invalid',unitsPerPackage:10,machineIds:2147483647})),/máquinas selecionadas/);
  assert.equal(await db.product.count(),count);
  const previous=await db.product.findUnique({where:{id:product.id}});
  await assert.rejects(updateProduct(fd({id:product.id,code:product.code,name:'Must roll back',unitsPerPackage:5,machineIds:2147483647,active:'on'})),/máquinas selecionadas/);
  assert.equal((await db.product.findUnique({where:{id:product.id}})).name,previous.name);

});

test('real session guards deny auditors writes and enforce database expiry and current roles',async()=>{
  const auth=load('lib/auth');
  const account=await db.user.create({data:{name:'Security auditor',role:'AUDITOR',pinHash:'test-auditor-hash'}});
  await auth.createSession({userId:account.id,name:account.name,role:'AUDITOR'},account.pinHash);
  await assert.rejects(auth.requireOperationalUser(),/redirect:\/access-denied/);
  await assert.rejects(auth.requireAdmin(),/redirect:\/access-denied/);
  assert.equal((await auth.requireAuditAccess()).id,account.id);
  await db.user.update({where:{id:account.id},data:{active:false}});
  assert.equal(await auth.getSession(),null);
  await db.user.update({where:{id:account.id},data:{active:true}});
  await db.execute('UPDATE AuthSession SET expiresAt=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE userId=?',[account.id]);
  assert.equal(await auth.getSession(),null);
});

test('second-worker PIN guessing is limited across requests without caching failed confirmation',async()=>{
  const {verifySecondWorker}=load('lib/second-worker-confirmation');
  const operator=await db.user.create({data:{name:'Security operator',role:'OPERATOR',pinHash:'test-operator-hash'}});
  const peer=await db.user.findFirst({where:{name:'Second worker'}});
  await db.execute('DELETE FROM AuthRateLimit WHERE bucket=?',[`peer:target:${peer.id}`]);
  for(let i=0;i<5;i++)await assert.rejects(verifySecondWorker(fd({secondWorkerId:peer.id,secondWorkerPin:'00000000'}),operator.id),/incorreto/);
  await assert.rejects(verifySecondWorker(fd({secondWorkerId:peer.id,secondWorkerPin:'12345678'}),operator.id),/Demasiadas tentativas/);
  assert.equal((await db.query('SELECT * FROM ShiftPeerConfirmation WHERE operatorId=?',[operator.id])).length,0);
});

test('backup failures leave no archive; successful archives are private and never written under public', {skip:process.platform==='win32'},async()=>{
  const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'sodilave-backup-'));
  const fake=path.join(temp,'dump');const backup=path.join(temp,'backup');
  fs.writeFileSync(fake,"#!/usr/bin/env node\nprocess.stdout.write('SQL test output');process.exit(process.env.FAIL_DUMP==='1'?1:0);\n",{mode:0o700});
  const env={...process.env,MYSQLDUMP_BIN:fake,BACKUP_DIR:backup,FAIL_DUMP:'1'};
  try {
    await assert.rejects(execFileAsync(process.execPath,['scripts/backup-database.mjs'],{cwd:root,env}));
    assert.deepEqual(fs.readdirSync(backup),[]);
    env.FAIL_DUMP='0';await execFileAsync(process.execPath,['scripts/backup-database.mjs'],{cwd:root,env});
    const files=fs.readdirSync(backup);assert.equal(files.length,1);assert.match(files[0],/\.sql\.gz$/);
    assert.equal(fs.statSync(path.join(backup,files[0])).mode & 0o777,0o600);
    assert.equal(require('node:zlib').gunzipSync(fs.readFileSync(path.join(backup,files[0]))).toString(),'SQL test output');
    env.BACKUP_DIR=path.join(root,'public','backups');
    await assert.rejects(execFileAsync(process.execPath,['scripts/backup-database.mjs'],{cwd:root,env}),error=>/pasta publicada/.test(error.stderr));
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('display pairing is single-use, bounded, revocable and stores only hashed credentials',async()=>{
  const {createDisplayDevice,revokeDisplayDevice}=load('app/actions/production-display');
  const {pairDisplay,getDisplayDevice,displayCookie,displayHash}=load('lib/production-display');
  await db.execute("DELETE FROM AuthRateLimit WHERE bucket='display:pair'");
  testCookies.delete(displayCookie);assert.equal(await getDisplayDevice(),null);
  const {code}=await createDisplayDevice(fd({name:'Factory TV'}));
  assert.match(code,/^\d{8}$/);
  const [pending]=await db.query('SELECT * FROM ProductionDisplayDevice WHERE pairingHash=?',[displayHash(code)]);
  assert.ok(pending);assert.equal(pending.tokenHash,null);assert.notEqual(pending.pairingHash,code);
  const attempts=await Promise.allSettled([pairDisplay(code),pairDisplay(code)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const token=testCookies.get(displayCookie);assert.match(token,/^[a-f0-9]{64}$/);
  assert.equal(cookieOptions.get(displayCookie).httpOnly,true);assert.equal(cookieOptions.get(displayCookie).sameSite,'strict');
  assert.equal((await getDisplayDevice()).id,pending.id);
  const [paired]=await db.query('SELECT * FROM ProductionDisplayDevice WHERE id=?',[pending.id]);
  assert.equal(paired.pairingHash,null);assert.equal(paired.tokenHash,displayHash(token));
  await revokeDisplayDevice(fd({id:pending.id}));assert.equal(await getDisplayDevice(),null);
  const expired=await createDisplayDevice(fd({name:'Expired TV'}));
  await db.execute('UPDATE ProductionDisplayDevice SET pairingExpiresAt=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE pairingHash=?',[displayHash(expired.code)]);
  await assert.rejects(pairDisplay(expired.code),/inválido ou expirado/);
  for(let i=0;i<7;i++)await assert.rejects(pairDisplay('invalid'),/inválido/);
  await assert.rejects(pairDisplay('00000000'),/Demasiadas/);
});

test('display orders follow the selected product, its letters and the current shift',async()=>{
  const {saveDisplayOrder}=load('app/actions/production-display');
  const {getProductionDisplayData}=load('lib/production-display');
  const now=new Date();const window=load('lib/shift').getShiftWindow(now);
  const tvMachine=await db.machine.create({data:{code:'8',name:'Display test',status:'RUNNING'}});
  const second=await db.product.create({data:{code:'DISPLAY-SECOND',name:'Second mould',unitsPerPackage:1}});
  for(const p of [product,second])await db.execute('INSERT INTO ProductMachine (productId,machineId) VALUES (?,?)',[p.id,tvMachine.id]);
  const order=fd({machineId:tvMachine.id,productId:product.id,destination:'PALLET',notes:'Four layers'});
  await saveDisplayOrder(order);
  const card=async(date=now)=>(await getProductionDisplayData(date)).machines.find(m=>m.id===tvMachine.id);
  let view=await card();assert.equal(view.lotState,'PLANNED');assert.equal(view.destination,'PALLET');assert.match(view.lot,/^AA[ABC]/);
  assert.notEqual((await card(window.end)).lot,view.lot);
  const row=await db.production.create({data:{machineId:tvMachine.id,productId:product.id,operatorId:user.id,shiftCode:window.code,productionLot:view.lot,status:'DRAFT',startedAt:now}});
  assert.equal((await card()).lotState,'REGISTERED');
  order.set('productId',second.id);await saveDisplayOrder(order);
  view=await card();assert.equal(view.lot,row.productionLot);assert.equal(view.lotState,'PLANNED');assert.match(view.product,/Second mould/);
  await db.execute("INSERT INTO ProductLotConfig (productId,majorLetter,minorLetter,updatedById) VALUES (?,'B','A',?)",[second.id,user.id]);
  view=await card();assert.match(view.lot,/^BA/);assert.equal(view.lotState,'PLANNED');
  await db.product.update({where:{id:second.id},data:{active:false}});
  view=await card();assert.equal(view.destination,null);assert.equal(view.lot,null);assert.match(view.warning,/desatualizada/);
  await assert.rejects(saveDisplayOrder(order),/produto ativo/);
  order.set('destination','invalid');await assert.rejects(saveDisplayOrder(order),/Verifique/);
  await db.production.update({where:{id:row.id},data:{status:'CANCELLED'}});
  await db.machine.update({where:{id:tvMachine.id},data:{status:'STOPPED'}});
  assert.equal(await card(),undefined);
  await db.machine.update({where:{id:tvMachine.id},data:{active:false}});
});

test('admin relocates whole stacks atomically, preserving quantities and rejecting stale/replayed/occupied moves',async()=>{
  const {relocateStoragePosition,transferStockMap,adjustStockMap}=load('app/actions/stock-map');
  const locations=[];
  for(let i=1;i<=3;i++)locations.push(await db.storageLocation.create({data:{warehouseCode:'MOVE',warehouseName:'Test moves',zoneType:'STACK',code:'M'+i,rowNumber:1,columnNumber:i}}));
  const productions=[];
  for(let i=1;i<=2;i++)productions.push(await db.production.create({data:{machineId:machine.id,productId:product.id,operatorId:user.id,shiftCode:'A',productionLot:'MOVE-'+i,status:'FINALIZED',quantityProduced:5,unitsPerPackageSnapshot:10,productionUnitSnapshot:'BAG'}}));
  for(const p of productions)await db.productionStorageBalance.create({data:{productionId:p.id,locationId:locations[0].id,quantityPackages:5}});
  const contents=productions.map(p=>({productionId:p.id,quantityPackages:5}));
  const move=fd({fromLocationId:locations[0].id,toLocationId:locations[1].id,expectedContents:JSON.stringify(contents),reason:'Wrong position selected by operator'});
  const auditBefore=await db.auditLog.count();
  await relocateStoragePosition(move);
  let balances=await db.query('SELECT * FROM ProductionStorageBalance WHERE productionId IN (?,?)',[...productions.map(p=>p.id)]);
  assert.equal(balances.length,2);assert.ok(balances.every(b=>b.locationId===locations[1].id&&b.quantityPackages===5));assert.equal(await db.auditLog.count(),auditBefore+1);
  await assert.rejects(relocateStoragePosition(move),/stock mudou/);
  move.set('fromLocationId',locations[1].id);move.set('toLocationId',locations[2].id);
  const individual=fd({productionId:productions[0].id,fromLocationId:locations[1].id,toLocationId:locations[0].id,quantityPackages:1,expectedQuantity:5,reason:'Partial move'});
  await transferStockMap(individual);await assert.rejects(transferStockMap(individual),/stock mudou/);
  await assert.rejects(relocateStoragePosition(move),/stock mudou/);
  contents[0].quantityPackages=4;move.set('expectedContents',JSON.stringify(contents));move.set('toLocationId',locations[0].id);
  await assert.rejects(relocateStoragePosition(move),/ocupada/);
  await assert.rejects(adjustStockMap(fd({productionId:productions[0].id,locationId:locations[1].id,newQuantityPackages:3,expectedQuantity:5,reason:'Stale count'})),/stock mudou/);
  move.set('toLocationId',locations[2].id);
  const results=await Promise.allSettled([relocateStoragePosition(move),relocateStoragePosition(move)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  balances=await db.query('SELECT SUM(quantityPackages) AS quantity FROM ProductionStorageBalance WHERE productionId IN (?,?)',[...productions.map(p=>p.id)]);
  assert.equal(Number(balances[0].quantity),10);
  const movements=await db.query('SELECT * FROM ProductionStorageMovement WHERE productionId IN (?,?)',[...productions.map(p=>p.id)]);
  assert.equal(movements.length,5);
});

test('application and migration connections use UTC regardless of the hosting default timezone',async()=>{
  const samples=await Promise.all(Array.from({length:4},()=>db.query("SELECT @@session.time_zone AS zone, NOW(3) AS clock")));
  for(const [row] of samples){assert.equal(row.zone,'+00:00');assert.ok(Math.abs(row.clock.getTime()-Date.now())<5000);}
  const script="import('./scripts/mysql-client.mjs').then(async ({query,closeDb})=>{try{const [r]=await query('SELECT @@session.time_zone AS zone');if(r.zone!=='+00:00')throw new Error('SQL timezone mismatch');}finally{await closeDb();}})";
  await execFileAsync(process.execPath,['--input-type=module','-e',script],{cwd:root,env:{...process.env,DATABASE_URL:url,TZ:'Europe/Lisbon'}});
});

test('orders preserve multi-item prices, reject invalid input and deduplicate concurrent submission',async()=>{
  const {createSalesOrder}=load('app/actions/sales-orders');const {getSalesOrders}=load('lib/sales-orders');
  const {lineTotalCents}=load('lib/order-values');
  assert.equal(lineTotalCents(3,'0.3350'),101);assert.equal(lineTotalCents(100,'0.0149'),149);
  const other=await db.product.create({data:{code:'ORDER-SECOND',name:'Second ordered product',unitsPerPackage:10}});
  const form=fd({customerName:'Order customer',customerReference:'Customer PO',orderDate:'2026-09-26',requestId:require('node:crypto').randomUUID(),items:JSON.stringify([{productId:product.id,quantityUnits:60,unitPrice:'0,4250'},{productId:other.id,quantityUnits:30,unitPrice:'1.50'}])});
  const results=await Promise.all([createSalesOrder(form),createSalesOrder(form)]);assert.equal(results[0].id,results[1].id);
  const [order]=await getSalesOrders({id:results[0].id});assert.equal(order.items.length,2);assert.equal(order.totalCents,7050);assert.equal(order.status,'PENDING');assert.equal(order.customerReference,'Customer PO');
  form.set('customerName','Changed payload');await assert.rejects(createSalesOrder(form),/outros dados/);
  form.set('requestId',require('node:crypto').randomUUID());form.set('orderDate','2026-02-30');await assert.rejects(createSalesOrder(form),/Verifique/);
  form.set('orderDate','2026-09-26');form.set('items',JSON.stringify([{productId:product.id,quantityUnits:1,unitPrice:'1'},{productId:product.id,quantityUnits:2,unitPrice:'1'}]));await assert.rejects(createSalesOrder(form),/uma vez/);
  form.set('items',JSON.stringify([{productId:product.id,quantityUnits:0,unitPrice:'1'}]));await assert.rejects(createSalesOrder(form),/quantidade/);
  form.set('items',JSON.stringify([{productId:product.id,quantityUnits:10,unitPrice:'1.23456'}]));await assert.rejects(createSalesOrder(form),/Preço inválido/);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM AuditLog WHERE entity=? AND entityId=?',['SalesOrder',String(order.id)]))[0].n,1);
});

test('registered orders constrain dispatches, partial deliveries, replay, cancellation and concurrent overdelivery',async()=>{
  const {getSalesOrders,getOrderDispatches}=load('lib/sales-orders');const {cancelSalesOrder}=load('app/actions/sales-orders');
  const [order]=(await getSalesOrders()).filter(o=>o.customerName==='Order customer');assert.ok(order);
  const position=await db.storageLocation.create({data:{warehouseCode:'ORDER',warehouseName:'Order warehouse',zoneType:'STACK',code:'O1',rowNumber:1,columnNumber:1}});
  const produced=[];
  for(const item of order.items){const row=await db.production.create({data:{machineId:machine.id,productId:item.productId,operatorId:user.id,shiftCode:'A',productionLot:'ORDER-LOT-'+item.id,status:'FINALIZED',quantityProduced:20,unitsPerPackageSnapshot:10,productionUnitSnapshot:'BAG'}});produced.push(row);await db.productionStorageBalance.create({data:{productionId:row.id,locationId:position.id,quantityPackages:20}});}
  const build=(index,quantity)=>fd({salesOrderItemId:order.items[index].id,requestId:require('node:crypto').randomUUID(),invoiceNumber:'FT-ORDER',dispatchDate:'2026-09-26',orderedQuantityUnits:quantity,[`stock_${produced[index].id}_${position.id}`]:quantity/10,customerName:'Forged customer',orderReference:'Forged reference',productId:999999});
  const first=build(0,20);const delivered=await dispatchFromOrder(first);
  const replay=await dispatchFromOrder(first);assert.equal(delivered.id,replay.id);
  const saved=await db.lotDispatch.findUnique({where:{id:delivered.id}});assert.equal(saved.customerName,order.customerName);assert.equal(saved.orderReference,order.reference);assert.equal(saved.productId,order.items[0].productId);
  let [current]=await getSalesOrders({id:order.id});assert.equal(current.status,'PARTIAL');assert.equal(current.items[0].remainingUnits,40);
  const race=await Promise.allSettled([dispatchFromOrder(build(0,40)),dispatchFromOrder(build(0,40))]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.match(race.find(r=>r.status==='rejected').reason.message,/por entregar/);
  const remaining=await dispatchFromOrder(build(1,30));[current]=await getSalesOrders({id:order.id});assert.equal(current.status,'COMPLETED');assert.ok(!(await getSalesOrders({pendingOnly:true})).some(o=>o.id===order.id));
  await assert.rejects(cancelSalesOrder(fd({id:order.id,reason:'Cannot cancel deliveries'})),/saídas registadas/);
  const second=race.find(r=>r.status==='fulfilled').value;
  await cancelLotDispatch(fd({dispatchId:second.id,reason:'Return shipment'}));[current]=await getSalesOrders({id:order.id});assert.equal(current.status,'PARTIAL');assert.equal(current.items[0].remainingUnits,40);
  await cancelLotDispatch(fd({dispatchId:delivered.id,reason:'Correction'}));await cancelLotDispatch(fd({dispatchId:remaining.id,reason:'Correction'}));
  [current]=await getSalesOrders({id:order.id});assert.equal(current.status,'PENDING');assert.ok(current.items.every(i=>i.deliveredUnits===0));
  const history=await getOrderDispatches(order.id);assert.equal(history.length,3);assert.ok(history.every(d=>d.cancelledAt));assert.ok(history.every(d=>d.lots.includes('ORDER-LOT-')));
  await assert.rejects(dispatchFromOrder(first),/anulada/);
  await cancelSalesOrder(fd({id:order.id,reason:'Wrong customer request'}));[current]=await getSalesOrders({id:order.id});assert.equal(current.status,'CANCELLED');
  await assert.rejects(dispatchFromOrder(build(0,10)),/encomenda foi anulada/);
  const balances=await db.query('SELECT quantityPackages FROM ProductionStorageBalance WHERE locationId=?',[position.id]);assert.ok(balances.every(b=>b.quantityPackages===20));
});

test('dispatch requires a registered order and rejects wrong-product stock without changing balances',async()=>{
  const {createSalesOrder}=load('app/actions/sales-orders');const {getSalesOrders}=load('lib/sales-orders');
  await assert.rejects(dispatchFromOrder(fd({customerName:'Manual',orderReference:'Manual',invoiceNumber:'FT',dispatchDate:'2026-09-26',productId:product.id,orderedQuantityUnits:1})),/encomenda registada/);
  const [other]=await db.query("SELECT id FROM Product WHERE code='ORDER-SECOND'");
  const created=await createSalesOrder(fd({customerName:'Wrong-stock check',orderDate:'2026-09-26',requestId:require('node:crypto').randomUUID(),items:JSON.stringify([{productId:product.id,quantityUnits:10,unitPrice:'1'}])}));
  const [order]=await getSalesOrders({id:created.id});const [wrong]=await db.query("SELECT p.id,b.locationId FROM Production p INNER JOIN ProductionStorageBalance b ON b.productionId=p.id WHERE p.productId=? AND p.productionLot LIKE 'ORDER-LOT-%' LIMIT 1",[other.id]);
  const count=await db.lotDispatch.count();
  const data=fd({salesOrderItemId:order.items[0].id,requestId:require('node:crypto').randomUUID(),invoiceNumber:'FT',dispatchDate:'2026-09-26',orderedQuantityUnits:10,[`stock_${wrong.id}_${wrong.locationId}`]:1});
  await assert.rejects(dispatchFromOrder(data),/pertencer ao artigo/);assert.equal(await db.lotDispatch.count(),count);
  data.set('dispatchDate','2026-02-30');await assert.rejects(dispatchFromOrder(data),/data de saída/);
  const [current]=await getSalesOrders({id:created.id});assert.equal(current.items[0].remainingUnits,10);
});

test('commerce permissions use real sessions: operators cannot read orders, logistics can operate, auditors only read',async()=>{
  const auth=load('lib/auth');
  const pinHash=await require('bcryptjs').hash('89898989',4);
  try {
    for(const role of ['OPERATOR','LOGISTICS','AUDITOR','ADMIN','PRODUCTION_MANAGER']) {
      const person=await db.user.create({data:{name:'Role '+role,role,pinHash}});
      await auth.createSession({userId:person.id,name:person.name,role},pinHash);
      if(role==='OPERATOR') await assert.rejects(auth.requireCommerceReadAccess(),/access-denied/);
      else assert.equal((await auth.requireCommerceReadAccess()).id,person.id);
      if(['OPERATOR','AUDITOR'].includes(role)) await assert.rejects(auth.requireCommerceUser(),/access-denied/);
      else assert.equal((await auth.requireCommerceUser()).id,person.id);
      if(role==='AUDITOR') await assert.rejects(auth.requireOperationalUser(),/access-denied/);
      else assert.equal((await auth.requireOperationalUser()).id,person.id);
      if(role!=='ADMIN') await assert.rejects(auth.requireAdmin(),/access-denied/);
      await auth.destroySession();
    }
  } finally {testCookies.clear();}
});

test('unit products force a 1:1 ratio and dispatch individual articles without package multiplication',async()=>{
  const {createProduct,updateProduct}=load('app/actions/admin');
  await createProduct(fd({code:'UNIT-CAP',name:'Cap counted individually',productionUnit:'UNIT',unitsPerPackage:100,machineIds:machine.id}));
  const cap=await db.product.findFirst({where:{code:'UNIT-CAP'}});
  assert.equal(cap.unitsPerPackage,1);assert.equal(cap.productionUnit,'UNIT');
  await updateProduct(fd({id:cap.id,code:cap.code,name:cap.name,productionUnit:'UNIT',unitsPerPackage:999,machineIds:machine.id,active:'on'}));
  assert.equal((await db.product.findUnique({where:{id:cap.id}})).unitsPerPackage,1);
  const produced=await db.production.create({data:{machineId:machine.id,productId:cap.id,operatorId:user.id,shiftCode:'A',productionLot:'UNIT-LOT',status:'FINALIZED',quantityProduced:12,unitsPerPackageSnapshot:1,productionUnitSnapshot:'UNIT'}});
  await db.productionStorageBalance.create({data:{productionId:produced.id,locationId:location.id,quantityPackages:12}});
  const order=await load('app/actions/sales-orders').createSalesOrder(fd({customerName:'Unit customer',orderDate:'2026-09-27',requestId:require('node:crypto').randomUUID(),items:JSON.stringify([{productId:cap.id,quantityUnits:3,unitPrice:'0.25'}])}));
  const [line]=await db.query('SELECT id FROM SalesOrderItem WHERE salesOrderId=?',[order.id]);
  const account=user;user={...user,role:'LOGISTICS'};
  try {
    await dispatchFromOrder(fd({salesOrderItemId:line.id,requestId:require('node:crypto').randomUUID(),invoiceNumber:'UNIT-FT',dispatchDate:'2026-09-27',orderedQuantityUnits:3,[`stock_${produced.id}_${location.id}`]:3}));
    const [balance]=await db.query('SELECT quantityPackages FROM ProductionStorageBalance WHERE productionId=?',[produced.id]);assert.equal(Number(balance.quantityPackages),9);
  } finally {user=account;}
  const {productionUnitLabel}=load('lib/production-unit');assert.equal(productionUnitLabel('UNIT',1),'unidade');assert.equal(productionUnitLabel('UNIT',9),'unidades');
});

test('duplicate material family codes retain independent lots and reject reparenting or stale stock edits',async()=>{
  const {createRawMaterial,createRawMaterialLot,updateRawMaterialLot}=load('app/actions/admin');
  await createRawMaterial(fd({code:'PEAD',name:'Grade A'}));await createRawMaterial(fd({code:'PEAD',name:'Grade B'}));
  const grades=await db.rawMaterial.findMany({where:{code:'PEAD'},orderBy:{id:'asc'}});assert.equal(grades.length,2);
  for(const grade of grades)await createRawMaterialLot(fd({rawMaterialId:grade.id,supplierLot:'SAME-SUPPLIER-LOT',quantityInitial:100}));
  const a=await db.rawMaterialLot.findFirst({where:{rawMaterialId:grades[0].id}});
  const b=await db.rawMaterialLot.findFirst({where:{rawMaterialId:grades[1].id}});assert.notEqual(a.id,b.id);
  const form=fd({id:a.id,rawMaterialId:grades[0].id,supplierLot:a.supplierLot,quantityInitial:100,quantityAvailable:90,expectedQuantityAvailable:100,status:'ACTIVE'});
  await updateRawMaterialLot(form);
  assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:a.id}})).quantityAvailable),90);
  assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:b.id}})).quantityAvailable),100);
  await assert.rejects(updateRawMaterialLot(form),/mudou entretanto/);
  form.set('rawMaterialId',String(grades[1].id));form.set('expectedQuantityAvailable','90');await assert.rejects(updateRawMaterialLot(form),/não pertence/);
});

test('deleting unused users removes them while historical users are visibly deactivated and sessions revoked',async()=>{
  const {deleteUser}=load('app/actions/admin');const auth=load('lib/auth');
  const unused=await db.user.create({data:{name:'Unused',pinHash:'unused',role:'OPERATOR'}});
  const removed=await deleteUser(fd({id:unused.id}));assert.match(removed.message,/eliminado/);assert.equal(await db.user.findUnique({where:{id:unused.id}}),null);
  const used=await db.user.create({data:{name:'Historical',pinHash:'history',role:'LOGISTICS'}});
  await db.auditLog.create({data:{userId:used.id,action:'CREATE',entity:'TestHistory'}});
  await auth.createSession({userId:used.id,name:used.name,role:used.role},used.pinHash);
  const disabled=await deleteUser(fd({id:used.id}));assert.match(disabled.message,/desativado/);
  assert.equal(Boolean((await db.user.findUnique({where:{id:used.id}})).active),false);assert.equal(await auth.getSession(),null);
  const [audit]=await db.query('SELECT userId FROM AuditLog WHERE entity=?',['TestHistory']);assert.equal(audit.userId,used.id);
  await assert.rejects(deleteUser(fd({id:user.id})),/sessão iniciada/);
  // A foreign-key history reference also protects users even if they have no audit entry.
  const withProduction=await db.user.create({data:{name:'Production owner',pinHash:'owner',role:'OPERATOR'}});
  await db.production.create({data:{machineId:machine.id,productId:product.id,operatorId:withProduction.id,shiftCode:'A',productionLot:'DELETION-HISTORY'}});
  assert.match((await deleteUser(fd({id:withProduction.id}))).message,/desativado/);
});

test('cap icons follow machine business codes after recreation, regardless of database ids',()=>{
  const {isCapMachine}=load('lib/machine-icon');
  for(const code of ['5','6','M5','M06','Máquina 5','Maq. 6','005'])assert.equal(isCapMachine(code),true,code);
  for(const code of ['1','7','15','56','M7'])assert.equal(isCapMachine(code),false,code);
});

test('checkup submission returns useful validation messages and saves a complete shift after initial setup',async()=>{
  const {submitShiftCheckups}=load('app/actions/checkups');const {getShiftWindow}=load('lib/shift');
  const stale=await submitShiftCheckups(fd({intent:'draft',shiftStart:'2000-01-01T00:00:00.000Z'}));assert.equal(stale.ok,false);assert.match(stale.message,/turno mudou/);
  await db.machine.updateMany({data:{status:'STOPPED'}});
  const running=await db.machine.create({data:{code:'CHECK-NEW',name:'Newly configured machine',status:'RUNNING'}});
  await db.weeklyStartup.create({data:{operatorId:user.id,status:'FINALIZED',shiftCode:getShiftWindow().code,startupDate:new Date(),coolingPump1:true,coolingPump2:false}});
  const form=fd({intent:'finalize',shiftStart:getShiftWindow().start.toISOString(),machineIds:running.id,chillerLargeC:5,chillerSmallC:5,ambientTempC:22,[`m${running.id}_oilLevel`]:'NORMAL',[`m${running.id}_oilTempStatus`]:'NORMAL',[`m${running.id}_waterPressure`]:3});
  const before=await db.machineCheckup.count();
  const missing=await submitShiftCheckups(form);assert.equal(missing.ok,false);assert.match(missing.message,/CHECK-NEW.*pressões/);assert.equal(await db.machineCheckup.count(),before);
  form.set(`m${running.id}_airPressure`,'6');
  const saved=await submitShiftCheckups(form);assert.equal(saved.ok,true,saved.message);assert.equal(saved.data.finalized,true);
  const repeated=await submitShiftCheckups(form);assert.equal(repeated.ok,true);assert.equal(repeated.data.general.id,saved.data.general.id);assert.equal(await db.machineCheckup.count(),before+1);
  const logistic=await db.user.create({data:{name:'Logistics peer',role:'LOGISTICS',pinHash:'test'}});
  assert.ok((await load('lib/second-worker-confirmation').getConfirmationWorkers(user.id)).some(row=>row.id===logistic.id));
});


test('material lots store independent manufacturers and suppliers, including edits',async()=>{
  const {createRawMaterial,createRawMaterialLot,updateRawMaterialLot,updateRawMaterial}=load('app/actions/admin');
  await createRawMaterial(fd({code:'PEAD-LOT-MAKERS',name:'Same grade'}));
  const mp=await db.rawMaterial.findFirst({where:{code:'PEAD-LOT-MAKERS'}});
  for(const [supplierLot,manufacturer,supplier] of [['MAKER-A','Manufacturer A','Supplier A'],['MAKER-B','Manufacturer B','Supplier B']]) {
    await createRawMaterialLot(fd({rawMaterialId:mp.id,supplierLot,manufacturer,supplier,quantityInitial:100}));
  }
  let [a,b]=await db.rawMaterialLot.findMany({where:{rawMaterialId:mp.id},orderBy:{id:'asc'}});
  assert.equal(a.manufacturer,'Manufacturer A');assert.equal(a.supplier,'Supplier A');
  assert.equal(b.manufacturer,'Manufacturer B');assert.equal(b.supplier,'Supplier B');
  await updateRawMaterialLot(fd({id:a.id,rawMaterialId:mp.id,supplierLot:a.supplierLot,manufacturer:'Manufacturer C',supplier:'Supplier C',quantityInitial:100,quantityAvailable:100,expectedQuantityAvailable:100,status:'ACTIVE'}));
  await updateRawMaterial(fd({id:mp.id,code:mp.code,name:'Updated grade',active:'on',manufacturer:'Ignored parent input'}));
  [a,b]=await db.rawMaterialLot.findMany({where:{rawMaterialId:mp.id},orderBy:{id:'asc'}});
  assert.equal(a.manufacturer,'Manufacturer C');assert.equal(a.supplier,'Supplier C');
  assert.equal(b.manufacturer,'Manufacturer B');assert.equal(b.supplier,'Supplier B');
  assert.equal((await db.rawMaterial.findUnique({where:{id:mp.id}})).manufacturer,null);
  const form=await getProductionFormData({allActiveMachines:true});
  assert.equal(form.lots.find(l=>l.id===a.id).manufacturer,'Manufacturer C');
  assert.equal(form.lots.find(l=>l.id===b.id).supplier,'Supplier B');
});

test('manufacturer migration preserves existing lot quantities and suppliers while copying parent manufacturer',async()=>{
  const migration=fs.readFileSync(path.join(root,'database/migrations/2026-09-27-raw-material-lot-manufacturer.sql'),'utf8')
    .replaceAll('`RawMaterialLot`','`TestLotManufacturerMigration`').replaceAll('`RawMaterial`','`TestMaterialManufacturerMigration`');
  await db.$transaction(async tx=>{
    try {
      await tx.execute('CREATE TEMPORARY TABLE TestMaterialManufacturerMigration (id INT PRIMARY KEY, manufacturer VARCHAR(191) NULL)');
      await tx.execute('CREATE TEMPORARY TABLE TestLotManufacturerMigration (id INT PRIMARY KEY, rawMaterialId INT, supplier VARCHAR(191), quantityAvailable DECIMAL(12,3))');
      await tx.execute("INSERT INTO TestMaterialManufacturerMigration VALUES (1,'Legacy maker'),(2,NULL)");
      await tx.execute("INSERT INTO TestLotManufacturerMigration VALUES (1,1,'Supplier A',12.5),(2,1,'Supplier B',0),(3,2,'Supplier C',100)");
      for(const statement of migration.split(';').map(s=>s.trim()).filter(Boolean))await tx.execute(statement);
      const rows=await tx.query('SELECT * FROM TestLotManufacturerMigration ORDER BY id');
      assert.deepEqual(rows.map(r=>r.manufacturer),['Legacy maker','Legacy maker',null]);
      assert.deepEqual(rows.map(r=>r.supplier),['Supplier A','Supplier B','Supplier C']);
      assert.deepEqual(rows.map(r=>Number(r.quantityAvailable)),[12.5,0,100]);
    } finally {
      await tx.execute('DROP TEMPORARY TABLE IF EXISTS TestLotManufacturerMigration');
      await tx.execute('DROP TEMPORARY TABLE IF EXISTS TestMaterialManufacturerMigration');
    }
  });
});

test('checkup color boundaries and categorical oil readings retain historical temperatures',()=>{
  const {conditionTone,pressureTone,oilTemperatureLabel}=load('lib/checkup-values');
  for(const [v,tone] of [['COLD','blue'],['NORMAL','green'],['HOT','yellow'],['VERY_HOT','orange']])assert.equal(conditionTone('temperature',v),'condition-'+tone);
  assert.equal(conditionTone('level','LOW'),'condition-red');for(const v of ['NORMAL','HIGH'])assert.equal(conditionTone('level',v),'condition-green');
  for(const [min,max] of [[6,10],[4,8]]){
    for(const v of [min,min+1,max])assert.equal(pressureTone(String(v),min,max),'condition-green');
    for(const v of [min-0.1,max+0.1])assert.equal(pressureTone(String(v),min,max),'condition-red');
    assert.equal(pressureTone('',min,max),'');
  }
  assert.equal(conditionTone('test','CONFORMING'),'condition-green');assert.equal(conditionTone('test','NON_CONFORMING'),'condition-red');assert.equal(conditionTone('test','NOT_PERFORMED'),'condition-orange');
  assert.equal(oilTemperatureLabel({oilTempStatus:'HOT',oilTempC:50}),'Quente');assert.match(oilTemperatureLabel({oilTempC:50}),/50 °C/);
});

test('shift boundaries use A at midnight, B at 08:00 and C at 16:00',()=>{
  const {getShiftWindow,getShiftWindowForDate}=load('lib/shift');const {formatProductionLot}=load('lib/lot');
  for(const [hour,minute,expected] of [[0,0,'A'],[7,59,'A'],[8,0,'B'],[15,59,'B'],[16,0,'C'],[23,59,'C']]){
    const date=new Date(2026,8,28,hour,minute);assert.equal(getShiftWindow(date).code,expected);
    assert.equal(formatProductionLot('3',expected,date),'AA'+expected+'14026m3');
  }
  assert.equal(getShiftWindowForDate('2026-09-28','A').start.getHours(),0);
  assert.equal(getShiftWindowForDate('2026-09-28','B').start.getHours(),8);
  assert.equal(getShiftWindowForDate('2026-09-28','C').end.getDate(),29);
});

test('letters belong to products and managers can choose either or both with a reason and stale-write protection',async()=>{
  const {saveProductLotConfig,editProducedLot}=load('app/actions/lots');const {generateProductionLot}=load('lib/lot');
  const p=await db.product.create({data:{code:'LOT-CONFIG',name:'Config test',unitsPerPackage:1}});
  const original=user;user={...user,role:'PRODUCTION_MANAGER'};
  const change=(a,b,version,reason='Mixture / settings changed')=>saveProductLotConfig(fd({productId:p.id,majorLetter:a,minorLetter:b,expectedVersion:version,reason}));
  try {
    assert.match(await generateProductionLot(p.id,'3','B',new Date(2026,8,28,8)),/^AAB14026m3$/);
    assert.equal((await change('','',0)).ok,false);
    const unchanged=await change('A','A',0);assert.equal(unchanged.ok,true);assert.match(unchanged.message,/já usa AA/);
    assert.equal((await db.query('SELECT * FROM ProductLotHistory WHERE productId=?',[p.id])).length,0);
    assert.equal((await change('A','Z',0,'')).ok,false);
    assert.equal((await change('A','Z',0)).ok,true);
    assert.equal((await change('Q','Z',1)).ok,true);
    assert.equal((await change('B','C',2)).ok,true);
    assert.match(await generateProductionLot(p.id,'3','B',new Date(2026,8,28,8)),/^BCB14026m3$/);
    assert.equal((await change('A','A',0)).ok,false);
    const results=await Promise.all([change('C','D',3),change('D','E',3)]);assert.equal(results.filter(r=>r.ok).length,1);
    assert.equal((await db.query('SELECT * FROM ProductLotHistory WHERE productId=?',[p.id])).length,4);
    for(const role of ['AUDITOR','OPERATOR','LOGISTICS']){user={...original,role};await assert.rejects(change('X','Y',4),/permissão/);await assert.rejects(editProducedLot(new FormData()),/permissão/);}
  } finally {user=original;}
});

test('two products on one machine share AA safely and existing-lot corrections preserve stock, dispatches and old labels',async()=>{
  const {editProducedLot,saveProductLotConfig}=load('app/actions/lots');
  const m=await db.machine.create({data:{code:'LOT3',name:'Two moulds',status:'RUNNING'}});
  const p1=await db.product.create({data:{code:'LOT-A',name:'First mould',unitsPerPackage:1}});
  const p2=await db.product.create({data:{code:'LOT-B',name:'Second mould',unitsPerPackage:1}});
  const raw=await db.rawMaterialLot.create({data:{rawMaterialId:material.id,supplierLot:'LOT-CONSUMPTION',quantityInitial:100,quantityAvailable:100}});
  const where=await db.storageLocation.create({data:{warehouseCode:'LOT',warehouseName:'Lots test',zoneType:'STACK',code:'L1',rowNumber:1,columnNumber:1}});
  for(const p of [p1,p2])await db.execute('INSERT INTO ProductMachine (productId,machineId) VALUES (?,?)',[p.id,m.id]);
  const form=p=>fd({intent:'finalize',machineId:m.id,productId:p.id,quantityProduced:4,initialWeightG:100,midWeightG:100,materialLotId_0:raw.id,percentage_0:100,quantityKg_0:1,leakStart:'CONFORMING',leakMid:'CONFORMING',dropStart:'CONFORMING',dropMid:'CONFORMING',[`storage_location_${where.id}`]:4});
  const a=await saveProduction(form(p1)),b=await saveProduction(form(p2));
  assert.equal(a.lot,b.lot);assert.match(a.lot,/^AA/);
  assert.equal(await db.query('SELECT id FROM CommercialLot WHERE productId=?',[p1.id]).then(r=>r.length),0);
  const order=await load('app/actions/sales-orders').createSalesOrder(fd({customerName:'Lot customer',orderDate:'2026-09-28',requestId:require('node:crypto').randomUUID(),items:JSON.stringify([{productId:p1.id,quantityUnits:1,unitPrice:'1'}])}));
  const [item]=await db.query('SELECT id FROM SalesOrderItem WHERE salesOrderId=?',[order.id]);
  const dispatch=await dispatchFromOrder(fd({salesOrderItemId:item.id,requestId:require('node:crypto').randomUUID(),invoiceNumber:'LOT-FT',dispatchDate:'2026-09-28',orderedQuantityUnits:1,[`stock_${a.id}_${where.id}`]:1}));
  // Emulate an existing label from the former commercial/internal lot system.
  await db.execute("INSERT INTO CommercialLot (code,productId,status,createdById) VALUES ('LEGACY-LOT',?,'ACTIVE',?)",[p1.id,user.id]);
  const [legacy]=await db.query("SELECT id FROM CommercialLot WHERE code='LEGACY-LOT'");
  await db.execute('INSERT INTO ProductionLotAssociation (productionId,commercialLotId,internalCode,labelCode) VALUES (?,?,?,?)',[a.id,legacy.id,a.lot,'LEGACY-LOT / '+a.lot]);
  const edit=(code,count,first,second)=>editProducedLot(fd({productId:p1.id,expectedCode:code,expectedCount:count,majorLetter:first,minorLetter:second,reason:'Correct printed label'}));
  assert.equal((await edit(a.lot,2,'Z','A')).ok,false);
  assert.equal((await edit(a.lot,1,'Z','A')).ok,true);
  const renamed='ZA'+a.lot.slice(2);
  assert.equal((await db.production.findUnique({where:{id:a.id}})).productionLot,renamed);
  assert.equal((await db.production.findUnique({where:{id:b.id}})).productionLot,b.lot);
  assert.equal((await db.query('SELECT oldCode,oldLabel FROM ProductionLotAlias WHERE productionId=?',[a.id]))[0].oldLabel,'LEGACY-LOT / '+a.lot);
  assert.equal((await db.query('SELECT labelCode FROM ProductionLotAssociation WHERE productionId=?',[a.id]))[0].labelCode,renamed);
  assert.equal(Number((await db.query('SELECT quantityPackages FROM ProductionStorageBalance WHERE productionId=?',[a.id]))[0].quantityPackages),3);
  assert.equal((await db.query('SELECT productionId FROM LotDispatchLine WHERE lotDispatchId=?',[dispatch.id]))[0].productionId,a.id);
  assert.match(await load('lib/lot').generateProductionLot(p1.id,m.code,'A'),/^AA/);
  assert.equal((await edit(a.lot,1,'Z','B')).ok,false);
  const conflict=await db.production.create({data:{machineId:m.id,productId:p1.id,operatorId:user.id,shiftCode:'A',productionLot:'ZZ'+a.lot.slice(2),status:'DRAFT'}});
  assert.equal((await edit(renamed,1,'Z','Z')).ok,false);
  // Saving an existing production keeps the corrected code, even when future letters change.
  assert.equal((await saveProductLotConfig(fd({productId:p1.id,majorLetter:'B',minorLetter:'B',expectedVersion:0,reason:'Next mixture'}))).ok,true);
  const correction=form(p1);correction.set('productionId',a.id);correction.set('exceptionReason','OTHER');correction.set('exceptionNotes','Weight check');
  await saveProduction(correction);assert.equal((await db.production.findUnique({where:{id:a.id}})).productionLot,renamed);
  await db.production.update({where:{id:conflict.id},data:{status:'CANCELLED'}});
  assert.equal((await edit(renamed,1,'Z','B')).ok,true);
  assert.equal((await edit('ZB'+a.lot.slice(2),1,'C','D')).ok,true);
  assert.equal((await db.query('SELECT * FROM ProductionLotAlias WHERE productionId=?',[a.id])).length,3);
  const available=await getAvailableFinishedLots();assert.equal(available.find(r=>r.productionId===a.id).availablePackages,3);
  await db.machine.update({where:{id:m.id},data:{status:'STOPPED',active:false}});
});

test('admin can manage storage and opening stock without affecting production counters or raw materials',async()=>{
  const {saveStorageLocation,removeStorageLocation,addOpeningStock}=load('app/actions/storage-admin');
  const {adjustStockMap}=load('app/actions/stock-map');
  const stock=load('lib/stock-map');const {getAdminProductionStats}=load('lib/admin-production-stats');const {getScoreboardData}=load('lib/scoreboards');
  const position={warehouseCode:'W3',warehouseName:'New warehouse',zoneType:'PALLET',code:'P-Z1',rowNumber:1,columnNumber:1};
  assert.equal((await saveStorageLocation(fd(position))).ok,true);
  const l=await db.storageLocation.findFirst({where:{warehouseCode:'W3'}});
  assert.equal((await saveStorageLocation(fd({...position,id:l.id,code:'P-A1'}))).ok,true);
  assert.equal((await db.storageLocation.findUnique({where:{id:l.id}})).code,'P-A1');
  const before=await getAdminProductionStats();const boardsBefore=await getScoreboardData();const mpBefore=Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable);
  const entry=fd({productId:product.id,machineId:machine.id,locationId:l.id,quantityPackages:10,lotCode:'INITIAL-TEST',requestId:require('node:crypto').randomUUID()});
  assert.equal((await addOpeningStock(entry)).ok,true);
  const p=await db.production.findFirst({where:{productionLot:'INITIAL-TEST'}});assert.equal(p.recordOrigin,'INITIAL_STOCK');
  assert.equal((await addOpeningStock(entry)).ok,true);
  assert.equal(await db.production.count({where:{productionLot:'INITIAL-TEST'}}),1,'retry must not create stock twice');
  const after=await getAdminProductionStats();assert.deepEqual(after.machines,before.machines);assert.equal(after.totalProduced,before.totalProduced);assert.equal(after.todayProduced,before.todayProduced);
  const boardsAfter=await getScoreboardData();assert.deepEqual(boardsAfter.shifts,boardsBefore.shifts);assert.deepEqual(boardsAfter.employees,boardsBefore.employees);
  assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),mpBefore);
  assert.equal((await stock.getStorageMapData()).find(x=>x.id===l.id).totalPackages,10);
  assert.equal((await removeStorageLocation(fd({id:l.id}))).ok,false);
  await adjustStockMap(fd({productionId:p.id,locationId:l.id,expectedQuantity:10,newQuantityPackages:12,reason:'Physical opening count'}));
  assert.equal((await db.production.findUnique({where:{id:p.id}})).quantityProduced,12);
  const order=await load('app/actions/sales-orders').createSalesOrder(fd({customerName:'Opening stock customer',orderDate:'2026-09-28',requestId:require('node:crypto').randomUUID(),items:JSON.stringify([{productId:product.id,quantityUnits:2*p.unitsPerPackageSnapshot,unitPrice:'1'}])}));
  const [item]=await db.query('SELECT id FROM SalesOrderItem WHERE salesOrderId=?',[order.id]);
  await dispatchFromOrder(fd({salesOrderItemId:item.id,requestId:require('node:crypto').randomUUID(),invoiceNumber:'INITIAL-FT',dispatchDate:'2026-09-28',orderedQuantityUnits:2*p.unitsPerPackageSnapshot,[`stock_${p.id}_${l.id}`]:2}));
  assert.equal((await stock.getStorageMapData()).find(x=>x.id===l.id).totalPackages,10);
  assert.equal((await removeStorageLocation(fd({id:l.id}))).ok,false);
  const admin=user;user={...user,role:'AUDITOR'};
  try {await assert.rejects(addOpeningStock(entry),/access-denied/);await assert.rejects(saveStorageLocation(fd(position)),/access-denied/);await assert.rejects(removeStorageLocation(fd({id:l.id})),/access-denied/);}finally{user=admin;}
  const empty={...position,code:'P-B1',columnNumber:2};await saveStorageLocation(fd(empty));const e=await db.storageLocation.findFirst({where:{warehouseCode:'W3',columnNumber:2}});
  assert.equal((await removeStorageLocation(fd({id:e.id}))).ok,true);assert.equal((await stock.getStorageLocations()).some(x=>x.id===e.id),false);
});

test('opening stock allows repeated legacy lots across positions while retries remain idempotent',async()=>{
  const {addOpeningStock}=load('app/actions/storage-admin');const uuid=require('node:crypto').randomUUID;
  const places=[];for(let i=0;i<2;i++)places.push(await db.storageLocation.create({data:{warehouseCode:'REPEAT',warehouseName:'Repeated lot',zoneType:'STACK',code:'R'+i,rowNumber:1,columnNumber:i+1}}));
  const inputs=places.map((l,i)=>fd({productId:product.id,machineId:machine.id,locationId:l.id,quantityPackages:5+i,lotCode:'OLD-COMMON-LOT',requestId:uuid()}));
  for(const input of inputs)assert.equal((await addOpeningStock(input)).ok,true);
  const retry=await Promise.all([addOpeningStock(inputs[0]),addOpeningStock(inputs[0])]);assert.ok(retry.every(r=>r.ok));
  assert.equal(await db.production.count({where:{productionLot:'OLD-COMMON-LOT'}}),2);
  const rows=await db.query('SELECT b.quantityPackages,b.locationId FROM ProductionStorageBalance b JOIN Production p ON p.id=b.productionId WHERE p.productionLot=?',['OLD-COMMON-LOT']);assert.deepEqual(rows.map(r=>Number(r.quantityPackages)).sort(),[5,6]);
  inputs[0].set('quantityPackages','99');assert.equal((await addOpeningStock(inputs[0])).ok,false);
  inputs[0].set('requestId',uuid());inputs[0].set('quantityPackages','2');assert.equal((await addOpeningStock(inputs[0])).ok,true);
  const [[sum]]=await Promise.all([db.query('SELECT SUM(b.quantityPackages) AS total FROM ProductionStorageBalance b JOIN Production p ON p.id=b.productionId WHERE p.productionLot=?',['OLD-COMMON-LOT'])]);assert.equal(Number(sum.total),13);
});

test('production handover assigns the previous shift for 30 minutes and signed forms retain their original shift',async t=>{
  const shifts=load('lib/shift'),periods=load('lib/production-period');
  for(const [h,min,code,day] of [[0,5,'C',27],[8,5,'A',28],[16,5,'B',28],[16,30,'B',28],[16,31,'C',28]]){const w=shifts.getProductionEntryWindow(new Date(2026,8,28,h,min));assert.equal(w.code,code);assert.equal(w.start.getDate(),day);}
  const window=shifts.getShiftWindow(new Date(2026,8,28,15,50)),token=periods.issueProductionPeriod(user.id,window);
  assert.equal(periods.readProductionPeriod(token,user.id,new Date(2026,8,28,16,35)).code,'B');
  assert.throws(()=>periods.readProductionPeriod(token,user.id+1,new Date(2026,8,28,16,5)),/turno/);
  assert.throws(()=>periods.readProductionPeriod(token+'x',user.id,new Date(2026,8,28,16,5)),/turno/);
  const m=await db.machine.create({data:{code:'GRACE',name:'Handover',status:'RUNNING'}});
  const p=await db.product.create({data:{code:'GRACE',name:'Handover product',unitsPerPackage:1}});await db.execute('INSERT INTO ProductMachine (productId,machineId) VALUES (?,?)',[p.id,m.id]);
  const mp=await db.rawMaterialLot.create({data:{rawMaterialId:material.id,supplierLot:'GRACE',quantityInitial:10,quantityAvailable:10}});
  const pos=await db.storageLocation.create({data:{warehouseCode:'GRACE',warehouseName:'Grace',zoneType:'STACK',code:'G1',rowNumber:1,columnNumber:1}});
  t.mock.timers.enable({apis:['Date'],now:new Date(2026,8,28,15,50)});
  try{
    const draft=await saveProduction(fd({machineId:m.id,productId:p.id,intent:'draft',productionPeriod:token}));
    t.mock.timers.setTime(new Date(2026,8,28,16,35).getTime());
    await db.machine.update({where:{id:m.id},data:{status:'STOPPED'}});
    await db.execute('INSERT INTO OperationSettings (id,pastProductionEnabled) VALUES (1,0) ON DUPLICATE KEY UPDATE pastProductionEnabled=0');
    await saveProduction(fd({productionId:draft.id,machineId:m.id,productId:p.id,intent:'finalize',quantityProduced:1,initialWeightG:100,midWeightG:100,materialLotId_0:mp.id,percentage_0:100,quantityKg_0:1,leakStart:'CONFORMING',leakMid:'CONFORMING',dropStart:'CONFORMING',dropMid:'CONFORMING',[`storage_location_${pos.id}`]:1}));
    const record=await db.production.findUnique({where:{id:draft.id}});assert.equal(record.shiftCode,'B');assert.equal(record.startedAt.getHours(),15);assert.match(record.productionLot,/^AAB/);
    const original=user;user={...user,role:'OPERATOR'};try{await assert.rejects(saveProduction(fd({productionId:draft.id,intent:'finalize'})),/30 minutos/);}finally{user=original;}
    t.mock.timers.setTime(new Date(2026,8,29,0,5).getTime());
    const late=await saveProduction(fd({machineId:m.id,productId:p.id,intent:'draft'}));const lateRecord=await db.production.findUnique({where:{id:late.id}});assert.equal(lateRecord.shiftCode,'C');assert.equal(lateRecord.startedAt.getDate(),28);assert.equal(lateRecord.startedAt.getHours(),16);
  }finally{t.mock.timers.reset();await db.machine.update({where:{id:m.id},data:{active:false}});}
});

test('historical file imports preview, preserve sources and old lots, reject duplicates and do not move current stock',async()=>{
  const {previewHistoricalImport,commitHistoricalImport}=load('app/actions/historical-import');
  const {parseHistoricalImport}=load('lib/historical-import-format');const {getAdminProductionStats}=load('lib/admin-production-stats');
  const p=await db.product.create({data:{code:'HISTORY',name:'Historical article',unitsPerPackage:32}});
  const source={schemaVersion:1,source:{type:'PAPER_SHIFT_SHEET',files:['scan-01.jpg'],sheetIndex:1},shift:{date:'2025-09-01',code:'B',workers:[{rawText:'Paper worker',userId:null}]},generalCheck:{commonAirPressure:8,commonWaterPressure:6},productions:[{machineCode:machine.code,product:{rawText:'Paper article',productId:null},productionLot:'OLD-ALL',quantityProduced:50,productionUnit:'BAG',unitsPerPackage:32,initialWeightG:100,midWeightG:102,materials:[{rawText:'Unknown old MP',rawMaterialLotId:null},{rawMaterialLotId:lot.id,percentage:100,quantityKg:5}],tests:{leakStart:'CONFORMING',dropStart:'CONFORMING'}}]};
  const mapping={products:{'Paper article':p.id},operators:{'Paper worker':user.id},machines:{}};
  const input=()=>fd({content:JSON.stringify(source),fileName:'history.json',mapping:JSON.stringify(mapping)});
  assert.equal(parseHistoricalImport('data;turno;maquina;produto;operador;lote;quantidade;unidade\n2025-09-01;B;1;"Product; name";Worker;OLD;5;BAG')[0].productKey,'Product; name');
  const unresolved=await previewHistoricalImport(fd({content:JSON.stringify(source),mapping:'{}'}));assert.equal(unresolved.ok,true);assert.ok(unresolved.errors>0);
  const beforeStock=Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),beforeCount=(await getAdminProductionStats()).totalProduced;
  let preview=await previewHistoricalImport(input());assert.equal(preview.ok,true);assert.equal(preview.errors,0);assert.equal(preview.newCount,1);
  let submit=input();submit.set('previewHash',preview.hash);assert.equal((await commitHistoricalImport(submit)).ok,false);submit.set('confirmed','yes');
  assert.deepEqual(await commitHistoricalImport(submit),{ok:true,created:1,skipped:0});
  const row=await db.production.findFirst({where:{productId:p.id}});assert.equal(row.recordOrigin,'HISTORICAL_IMPORT');assert.equal(row.productionLot,'OLD-ALL');assert.equal(row.startedAt.getFullYear(),2025);
  assert.equal(await db.productionStorageBalance.count({where:{productionId:row.id}}),0);assert.equal((await db.query('SELECT * FROM ProductionStockConsumption WHERE productionId=?',[row.id])).length,0);assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),beforeStock);assert.equal((await getAdminProductionStats()).totalProduced,beforeCount+50);
  const tests=await db.qualityTest.findMany({where:{productionId:row.id}});assert.equal(tests.filter(t=>t.moment==='MID'&&t.result==='NOT_PERFORMED').length,2);
  const [stored]=await db.query('SELECT payloadJson FROM HistoricalImportItem WHERE productionId=?',[row.id]);const payload=typeof stored.payloadJson==='string'?JSON.parse(stored.payloadJson):stored.payloadJson;assert.equal(payload.original.generalCheck.commonAirPressure,8);
  await assert.rejects(saveProduction(fd({productionId:row.id,intent:'finalize'})),/importação histórica/);
  preview=await previewHistoricalImport(input());assert.equal(preview.duplicateCount,1);submit=input();submit.set('confirmed','yes');submit.set('previewHash',preview.hash);assert.deepEqual(await commitHistoricalImport(submit),{ok:true,created:0,skipped:1});
  source.productions[0].quantityProduced=51;preview=await previewHistoricalImport(input());assert.ok(preview.errors>0);
  source.shift.date='2025-09-02';preview=await previewHistoricalImport(input());assert.equal(preview.errors,0);submit=input();submit.set('previewHash',preview.hash);submit.set('confirmed','yes');assert.equal((await commitHistoricalImport(submit)).ok,true);assert.equal(await db.production.count({where:{productionLot:'OLD-ALL'}}),2,'same old lot can span multiple dates');
  source.shift.date='2025-09-03';preview=await previewHistoricalImport(input());source.productions[0].quantityProduced=99;submit=input();submit.set('previewHash',preview.hash);submit.set('confirmed','yes');assert.equal((await commitHistoricalImport(submit)).ok,false,'payload changed after review');
  assert.equal(await db.production.count({where:{productId:p.id}}),2);
});


test('administrator corrects a late production and separates variants without copying stock; counters reflect corrections and deletion',async()=>{
  const {correctProductionRecord,deleteProductionRecord}=load('app/actions/production-admin');
  const {createProductVariant}=load('app/actions/product-variants');const {getStockCounters}=load('lib/stock-counters');
  const base=await db.product.create({data:{code:'JC5-R',name:'Jerrycan 5 L',unitsPerPackage:32,productionUnit:'BAG'}});
  await db.execute('INSERT INTO ProductMachine(productId,machineId) VALUES (?,?)',[base.id,machine.id]);
  await db.execute("INSERT INTO ProductLotConfig(productId,majorLetter,minorLetter) VALUES (?,'C','D')",[base.id]);
  const places=[];for(const [i,name]of ['Armazém Sede','Armazém Zona Industrial'].entries())places.push(await db.storageLocation.create({data:{warehouseCode:'CT'+i,warehouseName:name,zoneType:'STACK',rowNumber:1,columnNumber:1,code:'CT'+i}}));
  const row=await db.production.create({data:{machineId:machine.id,productId:base.id,operatorId:user.id,productionLot:'WRONG-TURN-PRINTED',recordOrigin:'PRODUCTION',status:'FINALIZED',shiftCode:'C',startedAt:new Date(2025,8,1,16,5),finalizedAt:new Date(2025,8,1,16,5),quantityProduced:10,productionUnitSnapshot:'BAG',unitsPerPackageSnapshot:32}});
  for(const [i,l]of places.entries())await db.productionStorageBalance.create({data:{productionId:row.id,locationId:l.id,quantityPackages:i?4:6}});
  const create=fd({id:base.id,expectedName:base.name,originalName:'Jerrycan 5 L — Rosca',name:'Jerrycan 5 L — Encaixe',code:'JC5-E',stockFamily:'Jerrycan 5 L'});
  assert.equal((await createProductVariant(create)).ok,true);assert.equal((await createProductVariant(create)).ok,false,'retry cannot duplicate variant');
  const variant=await db.product.findFirst({where:{code:'JC5-E'}});assert.equal(variant.stockFamily,'Jerrycan 5 L');assert.equal(await db.production.count({where:{productId:variant.id}}),0);
  assert.equal((await db.query('SELECT * FROM ProductMachine WHERE productId=?',[variant.id])).length,1);
  assert.equal((await db.query('SELECT majorLetter FROM ProductLotConfig WHERE productId=?',[variant.id]))[0].majorLetter,'C');
  const input=async()=>{
    const p=await db.production.findUnique({where:{id:row.id}});const bs=await db.query('SELECT locationId,quantityPackages FROM ProductionStorageBalance WHERE productionId=? ORDER BY locationId',[row.id]);
    return fd({id:row.id,productId:variant.id,operatorId:user.id,date:'2025-09-01',shiftCode:'B',quantityProduced:9,reason:'Closed 5 minutes after shift; correct neck variant',expectedUpdatedAt:p.updatedAt.toISOString(),expectedBalances:JSON.stringify(bs.map(b=>[Number(b.locationId),Number(b.quantityPackages)])),[`balance_${places[0].id}`]:6,[`balance_${places[1].id}`]:3});
  };
  const correction=await input();const beforeMP=Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable);
  const result=await correctProductionRecord(correction);assert.equal(result.ok,true,JSON.stringify(result));
  const fixed=await db.production.findUnique({where:{id:row.id}});assert.equal(fixed.shiftCode,'B');assert.equal(fixed.startedAt.getHours(),8);assert.equal(fixed.productId,variant.id);assert.equal(fixed.quantityProduced,9);assert.equal(fixed.productionLot,row.productionLot);
  assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:lot.id}})).quantityAvailable),beforeMP);
  assert.equal((await correctProductionRecord(correction)).ok,false,'stale edits rejected');
  let counters=await getStockCounters();assert.equal(counters.articles.find(a=>a.id===base.id).total,0);assert.equal(counters.articles.find(a=>a.id===variant.id).total,288);assert.equal(counters.families.find(f=>f.name==='Jerrycan 5 L').total,288);
  assert.deepEqual(counters.articles.find(a=>a.id===variant.id).warehouses.map(w=>w.units).sort((a,b)=>a-b),[96,192]);
  const invalid=await input();invalid.set('quantityProduced','1');assert.equal((await correctProductionRecord(invalid)).ok,false);assert.equal((await db.production.findUnique({where:{id:row.id}})).quantityProduced,9);
  const auditor=user;user={...user,role:'AUDITOR'};try{await assert.rejects(correctProductionRecord(invalid),/access-denied/);await assert.rejects(deleteProductionRecord(invalid),/access-denied/);await assert.rejects(createProductVariant(create),/access-denied/);}finally{user=auditor;}
  assert.equal((await deleteProductionRecord(fd({id:row.id,reason:'Duplicate test record',expectedUpdatedAt:fixed.updatedAt.toISOString()}))).ok,true);
  assert.equal((await db.production.findUnique({where:{id:row.id}})).status,'CANCELLED');assert.equal(await db.productionStorageBalance.count({where:{productionId:row.id}}),0);
  counters=await getStockCounters();assert.equal(counters.families.find(f=>f.name==='Jerrycan 5 L').total,0);
  assert.ok(await db.auditLog.findFirst({where:{entity:'Production',entityId:String(row.id),action:'ADMIN_CORRECTION'}}));
  const [dispatched]=await db.query("SELECT line.productionId FROM LotDispatchLine line JOIN LotDispatch d ON d.id=line.lotDispatchId WHERE d.cancelledAt IS NULL LIMIT 1");
  assert.ok(dispatched);const protectedResult=await deleteProductionRecord(fd({id:dispatched.productionId,reason:'Cannot remove shipped records'}));assert.equal(protectedResult.ok,false);assert.match(protectedResult.message,/saídas para clientes/);
});

test('imported history never appears as current or unlocated stock and cannot be located manually',async()=>{
  const imported=await db.production.findFirst({where:{recordOrigin:'HISTORICAL_IMPORT',status:'FINALIZED'}});assert.ok(imported);
  const unlocated=await load('lib/stock-map').getUnlocatedFinishedLots();assert.equal(unlocated.some(r=>r.productionId===imported.id),false);
  assert.equal((await load('lib/stock-counters').getStockCounters()).articles.find(r=>r.id===imported.productId).total,0);
  await assert.rejects(load('app/actions/stock-map').addUnlocatedStock(fd({productionId:imported.id,locationId:location.id,quantityPackages:1,reason:'History is not stock'})),/histórico importado/);
});

test('checkups retain the previous shift during the 30 minute grace, including stopped draft machines and midnight',async t=>{
  const {saveShiftCheckups}=load('app/actions/checkups');const {getShiftWindow}=load('lib/shift');
  const previousStates=await db.machine.findMany({where:{status:'RUNNING'}});await db.machine.updateMany({where:{status:'RUNNING'},data:{status:'STOPPED'}});
  const m=await db.machine.create({data:{code:'CHECKGRACE',name:'Checkup grace machine',status:'RUNNING'}});
  const fakeNow=new Date(2025,9,1,15,55);t.mock.timers.enable({apis:['Date'],now:fakeNow});
  const input=fd({shiftStart:getShiftWindow(fakeNow).start.toISOString(),intent:'draft',machineIds:m.id,chillerLargeC:5,chillerSmallC:6,ambientTempC:20,[`m${m.id}_oilTempStatus`]:'NORMAL',[`m${m.id}_oilLevel`]:'NORMAL',[`m${m.id}_airPressure`]:8,[`m${m.id}_waterPressure`]:6});
  try{
    // A running cycle is needed while still inside the shift.
    const cycle=await db.weeklyStartup.create({data:{operatorId:user.id,status:'FINALIZED',shiftCode:'B',startupDate:fakeNow,finalizedAt:fakeNow}});
    const draft=await saveShiftCheckups(input);input.set('generalId',String(draft.general.id));input.set(`m${m.id}_checkupId`,String(draft.machines[0].id));
    await db.machine.update({where:{id:m.id},data:{status:'STOPPED'}});
    t.mock.timers.setTime(new Date(2025,9,1,16,5).getTime());input.set('intent','finalize');assert.equal((await saveShiftCheckups(input)).finalized,true);
    const saved=await db.machineCheckup.findUnique({where:{id:draft.machines[0].id}});assert.equal(saved.shiftCode,'B');assert.equal(saved.observedAt.getHours(),15);
    t.mock.timers.setTime(new Date(2025,9,1,16,30).getTime());assert.equal((await saveShiftCheckups(input)).finalized,true);
    t.mock.timers.setTime(new Date(2025,9,1,16,30,1).getTime());await assert.rejects(saveShiftCheckups(input),/30 minutos/);
    await load('lib/machine-state').changeMachineStatus({machineId:m.id,toStatus:'RUNNING',type:'INTERMEDIATE_STARTUP',userId:user.id,occurredAt:new Date(2025,9,1,23,55)});
    await load('lib/machine-state').changeMachineStatus({machineId:m.id,toStatus:'STOPPED',type:'WEEKLY_SHUTDOWN',userId:user.id,occurredAt:new Date(2025,9,2,0,0)});
    input.delete('generalId');input.delete(`m${m.id}_checkupId`);input.set('shiftStart',getShiftWindow(new Date(2025,9,1,23,55)).start.toISOString());
    t.mock.timers.setTime(new Date(2025,9,2,0,5).getTime());const midnight=await saveShiftCheckups(input);const general=await db.shiftGeneralCheck.findUnique({where:{id:midnight.general.id}});assert.equal(general.shiftCode,'C');assert.equal(general.observedAt.getDate(),1);assert.equal(general.observedAt.getHours(),16);
    await db.weeklyStartup.update({where:{id:cycle.id},data:{status:'CANCELLED'}});
  }finally{t.mock.timers.reset();await db.machine.update({where:{id:m.id},data:{active:false,status:'STOPPED'}});for(const old of previousStates)await db.machine.update({where:{id:old.id},data:{status:'RUNNING'}});}
});

test('test-data reset previews safely, restores consumed MPs and preserves master data',async()=>{
  const tables=['User','Product','RawMaterial','RawMaterialLot','Machine','StorageLocation','CommercialLot','SalesOrder','Maintenance'];
  const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>{const [r]=await db.query(`SELECT COUNT(*) AS total FROM ${table}`);return [table,Number(r.total)];})));
  const original=await counts();const productionCount=await db.production.count();
  const args=['scripts/reset-test-data.mjs'];const opts={cwd:root,env:process.env};
  const preview=await execFileAsync(process.execPath,args,opts);assert.match(preview.stdout,/SIMULAÇÃO/);assert.equal(await db.production.count(),productionCount);
  await assert.rejects(execFileAsync(process.execPath,[...args,'--execute'],opts));assert.equal(await db.production.count(),productionCount);
  // Existing fixtures deliberately exercise manual adjustments; reconcile their initial bounds for this reset test.
  await db.execute('UPDATE RawMaterialLot l JOIN (SELECT rawMaterialLotId,SUM(quantityKg) consumed FROM ProductionStockConsumption GROUP BY rawMaterialLotId) c ON c.rawMaterialLotId=l.id SET l.quantityInitial=GREATEST(l.quantityInitial,l.quantityAvailable+c.consumed)');
  const restored=await db.query('SELECT l.id,l.quantityAvailable+COALESCE(c.consumed,0) expected FROM RawMaterialLot l LEFT JOIN (SELECT rawMaterialLotId,SUM(quantityKg) consumed FROM ProductionStockConsumption GROUP BY rawMaterialLotId) c ON c.rawMaterialLotId=l.id');
  await execFileAsync(process.execPath,[...args,'--execute','--confirm=APAGAR_TESTES'],opts);
  assert.deepEqual(await counts(),original);
  for(const table of ['Production','MachineCheckup','ShiftGeneralCheck','WeeklyStartup','WeeklyShutdown','MachineEvent','Incident','LotDispatch','ProductionStorageBalance','ProductionStockConsumption']){const [row]=await db.query(`SELECT COUNT(*) AS total FROM ${table}`);assert.equal(Number(row.total),0,table);}
  assert.equal(await db.machine.count({where:{status:'RUNNING'}}),0);
  for(const l of restored)assert.equal(Number((await db.rawMaterialLot.findUnique({where:{id:l.id}})).quantityAvailable),Number(l.expected));
  assert.ok(await db.auditLog.findFirst({where:{action:'RESET_TEST_DATA'}}));
});
