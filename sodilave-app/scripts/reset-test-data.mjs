// Deliberately opt-in. Run only with the application stopped and a database backup.
import { db, closeDb } from "./mysql-client.mjs";
const execute=process.argv.includes("--execute");
const confirmed=process.argv.includes("--confirm=APAGAR_TESTES");
const cleared=["MachineDisplayOrder","ProductionStorageMovement","ProductionStorageBalance","LotDispatchLine","LotDispatch","ProductionStockConsumption","ProductionLotAssociation","ProductionCavityTest","ProductionCavityData","QualityTest","ProductionMaterial","Production","MachineCheckup","ShiftGeneralCheck","WeeklyShutdownMachine","WeeklyShutdown","WeeklyStartupMachine","WeeklyStartup","MachineEvent","Incident","ShiftPeerConfirmation"];
let connection;
try {
  connection=await db.getConnection();
  const [[server]]=await connection.query("SELECT DATABASE() AS databaseName");
  console.log(`Base selecionada: ${server.databaseName}`);
  console.log("Apaga produções (incluindo stock inicial), posições de stock ocupado, saídas, arranques, paragens, verificações, ocorrências, eventos e confirmações de turno.");
  console.log("Preserva produtos, utilizadores, máquinas, matérias-primas e seus lotes, posições do armazém, encomendas, lotes comerciais, letras de controlo, manutenções e auditoria. Repõe o consumo de matérias-primas registado pelas produções apagadas.");
  const counts={};
  for(const table of cleared){const [[row]]=await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);counts[table]=Number(row.total);}
  console.table(counts);
  if(!execute){console.log("SIMULAÇÃO: nenhum dado alterado. Depois de parar a app e fazer backup, execute npm run reset:test-data:execute para apagar os testes.");}
  else {
    if(!confirmed)throw new Error("Falta --confirm=APAGAR_TESTES. Não foi alterado nenhum dado.");
    await connection.beginTransaction();
    try {
      await connection.query("SELECT id FROM Machine ORDER BY id FOR UPDATE");
      await connection.query("SELECT id FROM Production ORDER BY id FOR UPDATE");
      await connection.query("SELECT id FROM RawMaterialLot ORDER BY id FOR UPDATE");
      const [overflow]=await connection.query(`SELECT l.id FROM RawMaterialLot l JOIN (SELECT rawMaterialLotId,SUM(quantityKg) AS consumed FROM ProductionStockConsumption GROUP BY rawMaterialLotId) c ON c.rawMaterialLotId=l.id WHERE l.quantityAvailable+c.consumed>l.quantityInitial+0.0005`);
      if(overflow.length)throw new Error("A reposição do consumo excederia a quantidade inicial de um lote de MP. Reveja as correções de stock antes do reset.");
      await connection.query(`UPDATE RawMaterialLot l JOIN (SELECT rawMaterialLotId,SUM(quantityKg) AS consumed FROM ProductionStockConsumption GROUP BY rawMaterialLotId) c ON c.rawMaterialLotId=l.id SET l.quantityAvailable=l.quantityAvailable+c.consumed,l.status=CASE WHEN l.status='DEPLETED' AND l.quantityAvailable+c.consumed>0 THEN 'ACTIVE' ELSE l.status END`);
      // Remove polymorphic confirmations before their targets; unrelated history remains.
      await connection.query("DELETE FROM RecordConfirmation WHERE entity IN ('Production','MachineCheckup','ShiftGeneralCheck','WeeklyStartup','WeeklyShutdown','Incident','MachineEvent')");
      for(const table of cleared)await connection.query(`DELETE FROM \`${table}\``);
      await connection.query("UPDATE Machine SET status='STOPPED',statusChangedAt=NOW(3)");
      await connection.query("DELETE FROM AuthSession");
      await connection.query("UPDATE User SET sessionVersion=sessionVersion+1");
      await connection.query("INSERT INTO AuditLog (action,entity,details) VALUES ('RESET_TEST_DATA','Application',?)",[JSON.stringify({database:server.databaseName,counts,rawMaterialConsumptionRestored:true})]);
      await connection.commit();
      console.log("Reset concluído. Horas e contadores de produção a zero; máquinas paradas. Faça login de novo, registe o stock inicial e abra um novo arranque semanal.");
    } catch(error){await connection.rollback();throw error;}
  }
} catch(error){console.error(error instanceof Error?error.message:"Falha no reset.");process.exitCode=1;}
finally {connection?.release();await closeDb();}
