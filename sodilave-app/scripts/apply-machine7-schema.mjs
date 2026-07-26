import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ProductionCavityData (
      productionId INT NOT NULL,
      rightInitialWeightG DECIMAL(10,2) NULL,
      rightMidWeightG DECIMAL(10,2) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (productionId),
      CONSTRAINT ProductionCavityData_productionId_fkey
        FOREIGN KEY (productionId) REFERENCES Production(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ProductionCavityTest (
      id INT NOT NULL AUTO_INCREMENT,
      productionId INT NOT NULL,
      cavity VARCHAR(10) NOT NULL,
      type VARCHAR(20) NOT NULL,
      moment VARCHAR(20) NOT NULL,
      result VARCHAR(30) NOT NULL,
      measuredAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY ProductionCavityTest_unique (productionId, cavity, type, moment),
      CONSTRAINT ProductionCavityTest_productionId_fkey
        FOREIGN KEY (productionId) REFERENCES Production(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  console.log("Estrutura da máquina 7 aplicada com sucesso.");
} catch (error) {
  console.error("Não foi possível aplicar a estrutura da máquina 7.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
