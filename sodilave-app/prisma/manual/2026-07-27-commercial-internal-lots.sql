CREATE TABLE IF NOT EXISTS `ProductionCavityData` (
  `productionId` INT NOT NULL,
  `rightInitialWeightG` DECIMAL(10,2) NULL,
  `rightMidWeightG` DECIMAL(10,2) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`productionId`),
  CONSTRAINT `ProductionCavityData_productionId_fkey` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProductionCavityTest` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `productionId` INT NOT NULL,
  `cavity` VARCHAR(10) NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `moment` VARCHAR(20) NOT NULL,
  `result` VARCHAR(30) NOT NULL,
  `measuredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ProductionCavityTest_unique` (`productionId`,`cavity`,`type`,`moment`),
  CONSTRAINT `ProductionCavityTest_productionId_fkey` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MachineLotConfig` (
  `machineId` INT NOT NULL,
  `majorLetter` CHAR(1) NOT NULL DEFAULT 'A',
  `minorLetter` CHAR(1) NOT NULL DEFAULT 'A',
  `updatedById` INT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`machineId`),
  CONSTRAINT `MachineLotConfig_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MachineLotConfig_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MachineLotConfigHistory` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `machineId` INT NOT NULL,
  `previousMajor` CHAR(1) NOT NULL,
  `previousMinor` CHAR(1) NOT NULL,
  `newMajor` CHAR(1) NOT NULL,
  `newMinor` CHAR(1) NOT NULL,
  `changeType` VARCHAR(20) NOT NULL,
  `reason` TEXT NOT NULL,
  `changedById` INT NOT NULL,
  `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `MachineLotConfigHistory_machineId_idx` (`machineId`),
  CONSTRAINT `MachineLotConfigHistory_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MachineLotConfigHistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CommercialLot` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `productId` INT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `notes` TEXT NULL,
  `createdById` INT NOT NULL,
  `closedById` INT NULL,
  `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `CommercialLot_code_key` (`code`),
  KEY `CommercialLot_product_status_idx` (`productId`,`status`),
  CONSTRAINT `CommercialLot_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CommercialLot_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CommercialLot_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CommercialLotMaterial` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `commercialLotId` INT NOT NULL,
  `rawMaterialId` INT NOT NULL,
  `percentage` DECIMAL(6,3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `CommercialLotMaterial_unique` (`commercialLotId`,`rawMaterialId`),
  CONSTRAINT `CommercialLotMaterial_commercialLotId_fkey` FOREIGN KEY (`commercialLotId`) REFERENCES `CommercialLot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CommercialLotMaterial_rawMaterialId_fkey` FOREIGN KEY (`rawMaterialId`) REFERENCES `RawMaterial`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProductionLotAssociation` (
  `productionId` INT NOT NULL,
  `commercialLotId` INT NOT NULL,
  `internalCode` VARCHAR(64) NOT NULL,
  `labelCode` VARCHAR(128) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`productionId`),
  UNIQUE KEY `ProductionLotAssociation_internalCode_key` (`internalCode`),
  KEY `ProductionLotAssociation_commercialLotId_idx` (`commercialLotId`),
  CONSTRAINT `ProductionLotAssociation_productionId_fkey` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductionLotAssociation_commercialLotId_fkey` FOREIGN KEY (`commercialLotId`) REFERENCES `CommercialLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RecordConfirmation` (
  `entity` VARCHAR(64) NOT NULL,
  `entityId` INT NOT NULL,
  `confirmedById` INT NOT NULL,
  `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`entity`,`entityId`),
  KEY `RecordConfirmation_confirmedById_idx` (`confirmedById`),
  CONSTRAINT `RecordConfirmation_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProductMachine` (
  `productId` INT NOT NULL,
  `machineId` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`productId`,`machineId`),
  KEY `ProductMachine_machineId_idx` (`machineId`),
  CONSTRAINT `ProductMachine_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductMachine_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `MachineLotConfig` (`machineId`,`majorLetter`,`minorLetter`)
SELECT `id`,'A','A' FROM `Machine`
ON DUPLICATE KEY UPDATE `machineId` = VALUES(`machineId`);

INSERT IGNORE INTO `ProductMachine` (`productId`,`machineId`)
SELECT p.`id`,m.`id` FROM `Product` p CROSS JOIN `Machine` m WHERE m.`active` = 1;
