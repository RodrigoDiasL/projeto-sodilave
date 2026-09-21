-- Schema base da Sodilave sem ORM.
-- Compatível com MySQL/MariaDB e preparado para instalação numa base vazia.

CREATE TABLE IF NOT EXISTS `User` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `pinHash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'OPERATOR',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Machine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'STOPPED',
  `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Machine_code_key` (`code`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Product` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `packageType` VARCHAR(191) NULL,
  `unitsPerPackage` INT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Product_code_key` (`code`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RawMaterial` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `materialType` VARCHAR(191) NULL,
  `color` VARCHAR(191) NULL,
  `manufacturer` VARCHAR(191) NULL,
  `internalReference` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `unit` VARCHAR(32) NOT NULL DEFAULT 'kg',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `RawMaterial_code_key` (`code`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RawMaterialLot` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rawMaterialId` INT NOT NULL,
  `supplierLot` VARCHAR(191) NOT NULL,
  `supplier` VARCHAR(191) NULL,
  `quantityInitial` DECIMAL(12,3) NOT NULL,
  `quantityAvailable` DECIMAL(12,3) NOT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiryDate` DATETIME(3) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `RawMaterialLot_rawMaterialId_supplierLot_key` (`rawMaterialId`,`supplierLot`),
  KEY `RawMaterialLot_rawMaterialId_idx` (`rawMaterialId`),
  CONSTRAINT `RawMaterialLot_rawMaterialId_fkey` FOREIGN KEY (`rawMaterialId`) REFERENCES `RawMaterial`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProductionLotRule` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `prefix` VARCHAR(191) NOT NULL DEFAULT 'SD',
  `template` VARCHAR(255) NOT NULL DEFAULT '{PREFIX}-{YY}{WW}-{SHIFT}-{MACHINE}-{SEQ}',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Production` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `machineId` INT NOT NULL,
  `productId` INT NOT NULL,
  `operatorId` INT NOT NULL,
  `productionLot` VARCHAR(191) NOT NULL,
  `shiftCode` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finalizedAt` DATETIME(3) NULL,
  `initialWeightG` DECIMAL(10,2) NULL,
  `midWeightG` DECIMAL(10,2) NULL,
  `quantityProduced` INT NULL,
  `observations` TEXT NULL,
  `exceptionReason` VARCHAR(191) NULL,
  `exceptionNotes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Production_productionLot_key` (`productionLot`),
  KEY `Production_machineId_idx` (`machineId`),
  KEY `Production_productId_idx` (`productId`),
  KEY `Production_operatorId_idx` (`operatorId`),
  KEY `Production_startedAt_idx` (`startedAt`),
  CONSTRAINT `Production_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Production_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Production_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProductionMaterial` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `productionId` INT NOT NULL,
  `rawMaterialLotId` INT NOT NULL,
  `percentage` DECIMAL(6,3) NULL,
  `quantityKg` DECIMAL(12,3) NULL,
  PRIMARY KEY (`id`),
  KEY `ProductionMaterial_productionId_idx` (`productionId`),
  KEY `ProductionMaterial_rawMaterialLotId_idx` (`rawMaterialLotId`),
  CONSTRAINT `ProductionMaterial_productionId_fkey` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductionMaterial_rawMaterialLotId_fkey` FOREIGN KEY (`rawMaterialLotId`) REFERENCES `RawMaterialLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `QualityTest` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `productionId` INT NOT NULL,
  `type` VARCHAR(32) NOT NULL,
  `moment` VARCHAR(32) NOT NULL,
  `result` VARCHAR(32) NOT NULL,
  `notes` VARCHAR(191) NULL,
  `measuredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `QualityTest_productionId_type_moment_key` (`productionId`,`type`,`moment`),
  CONSTRAINT `QualityTest_productionId_fkey` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MachineCheckup` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `machineId` INT NOT NULL,
  `operatorId` INT NOT NULL,
  `shiftCode` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finalizedAt` DATETIME(3) NULL,
  `oilTempC` DECIMAL(6,2) NULL,
  `oilLevel` VARCHAR(32) NULL,
  `waterPressure` DECIMAL(6,2) NULL,
  `airPressure` DECIMAL(6,2) NULL,
  `cleanMachineArea` TINYINT(1) NOT NULL DEFAULT 0,
  `hasBreakdown` TINYINT(1) NOT NULL DEFAULT 0,
  `breakdownStoppedMachine` TINYINT(1) NOT NULL DEFAULT 0,
  `breakdownDescription` TEXT NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `MachineCheckup_machineId_idx` (`machineId`),
  KEY `MachineCheckup_operatorId_idx` (`operatorId`),
  CONSTRAINT `MachineCheckup_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `MachineCheckup_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ShiftGeneralCheck` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `operatorId` INT NOT NULL,
  `shiftCode` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finalizedAt` DATETIME(3) NULL,
  `chillerLargeC` DECIMAL(6,2) NULL,
  `chillerSmallC` DECIMAL(6,2) NULL,
  `ambientTempC` DECIMAL(6,2) NULL,
  `cleanDispatch` TINYINT(1) NOT NULL DEFAULT 0,
  `cleanStorage` TINYINT(1) NOT NULL DEFAULT 0,
  `cleanProduction` TINYINT(1) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ShiftGeneralCheck_operatorId_idx` (`operatorId`),
  CONSTRAINT `ShiftGeneralCheck_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `AuditLog` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NULL,
  `action` VARCHAR(191) NOT NULL,
  `entity` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NULL,
  `details` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `AuditLog_userId_idx` (`userId`),
  CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WeeklyStartup` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `operatorId` INT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  `startupDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `shiftCode` VARCHAR(32) NOT NULL,
  `chillerSmall` TINYINT(1) NOT NULL DEFAULT 0,
  `chillerLarge` TINYINT(1) NOT NULL DEFAULT 0,
  `coolingPump` TINYINT(1) NOT NULL DEFAULT 0,
  `compressor` TINYINT(1) NOT NULL DEFAULT 0,
  `airDryers` TINYINT(1) NOT NULL DEFAULT 0,
  `airDemolecularizer` TINYINT(1) NOT NULL DEFAULT 0,
  `productionWindows` VARCHAR(32) NULL,
  `storageWindows` VARCHAR(32) NULL,
  `dispatchWindows` VARCHAR(32) NULL,
  `forkliftIntegrity` VARCHAR(32) NULL,
  `emergencyLighting` VARCHAR(32) NULL,
  `observations` TEXT NULL,
  `finalizedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `WeeklyStartup_operatorId_idx` (`operatorId`),
  CONSTRAINT `WeeklyStartup_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WeeklyStartupMachine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `weeklyStartupId` INT NOT NULL,
  `machineId` INT NOT NULL,
  `acrylics` VARCHAR(32) NULL,
  `plasticTrays` VARCHAR(32) NULL,
  `lighting` VARCHAR(32) NULL,
  `extruderTemperatures` VARCHAR(32) NULL,
  `lubrication` VARCHAR(32) NULL,
  `mouldCleaning` VARCHAR(32) NULL,
  `beltsTraysTables` VARCHAR(32) NULL,
  `waterFilters` VARCHAR(32) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `WeeklyStartupMachine_weeklyStartupId_machineId_key` (`weeklyStartupId`,`machineId`),
  KEY `WeeklyStartupMachine_machineId_idx` (`machineId`),
  CONSTRAINT `WeeklyStartupMachine_weeklyStartupId_fkey` FOREIGN KEY (`weeklyStartupId`) REFERENCES `WeeklyStartup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WeeklyStartupMachine_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WeeklyShutdown` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `operatorId` INT NOT NULL,
  `weeklyStartupId` INT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  `shutdownDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `shiftCode` VARCHAR(32) NOT NULL,
  `cleanDispatch` TINYINT(1) NOT NULL DEFAULT 0,
  `cleanStorage` TINYINT(1) NOT NULL DEFAULT 0,
  `cleanProduction` TINYINT(1) NOT NULL DEFAULT 0,
  `observations` TEXT NULL,
  `finalizedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `WeeklyShutdown_weeklyStartupId_key` (`weeklyStartupId`),
  KEY `WeeklyShutdown_operatorId_idx` (`operatorId`),
  CONSTRAINT `WeeklyShutdown_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `WeeklyShutdown_weeklyStartupId_fkey` FOREIGN KEY (`weeklyStartupId`) REFERENCES `WeeklyStartup`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `WeeklyShutdownMachine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `weeklyShutdownId` INT NOT NULL,
  `machineId` INT NOT NULL,
  `externalCleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `acrylicsCleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `mouldCleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `traysCleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `catchersCleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `beltsCleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `packingTableCleaning` TINYINT(1) NOT NULL DEFAULT 0,
  `surroundingArea` TINYINT(1) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `WeeklyShutdownMachine_weeklyShutdownId_machineId_key` (`weeklyShutdownId`,`machineId`),
  KEY `WeeklyShutdownMachine_machineId_idx` (`machineId`),
  CONSTRAINT `WeeklyShutdownMachine_weeklyShutdownId_fkey` FOREIGN KEY (`weeklyShutdownId`) REFERENCES `WeeklyShutdown`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WeeklyShutdownMachine_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Incident` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `machineId` INT NOT NULL,
  `checkupId` INT NULL,
  `type` VARCHAR(32) NOT NULL DEFAULT 'BREAKDOWN',
  `occurredAt` DATETIME(3) NOT NULL,
  `description` TEXT NOT NULL,
  `stoppedMachine` TINYINT(1) NOT NULL DEFAULT 1,
  `createdById` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Incident_checkupId_key` (`checkupId`),
  KEY `Incident_machineId_idx` (`machineId`),
  KEY `Incident_createdById_idx` (`createdById`),
  CONSTRAINT `Incident_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Incident_checkupId_fkey` FOREIGN KEY (`checkupId`) REFERENCES `MachineCheckup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Incident_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Maintenance` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  `performedAt` DATETIME(3) NOT NULL,
  `completedAt` DATETIME(3) NULL,
  `observations` TEXT NOT NULL,
  `createdById` INT NOT NULL,
  `incidentId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Maintenance_incidentId_key` (`incidentId`),
  KEY `Maintenance_createdById_idx` (`createdById`),
  CONSTRAINT `Maintenance_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Maintenance_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MaintenanceMachine` (
  `maintenanceId` INT NOT NULL,
  `machineId` INT NOT NULL,
  PRIMARY KEY (`maintenanceId`,`machineId`),
  KEY `MaintenanceMachine_machineId_idx` (`machineId`),
  CONSTRAINT `MaintenanceMachine_maintenanceId_fkey` FOREIGN KEY (`maintenanceId`) REFERENCES `Maintenance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MaintenanceMachine_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MaintenanceParticipant` (
  `maintenanceId` INT NOT NULL,
  `userId` INT NOT NULL,
  PRIMARY KEY (`maintenanceId`,`userId`),
  KEY `MaintenanceParticipant_userId_idx` (`userId`),
  CONSTRAINT `MaintenanceParticipant_maintenanceId_fkey` FOREIGN KEY (`maintenanceId`) REFERENCES `Maintenance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MaintenanceParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MachineEvent` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `machineId` INT NOT NULL,
  `type` VARCHAR(32) NOT NULL,
  `fromStatus` VARCHAR(32) NULL,
  `toStatus` VARCHAR(32) NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `reason` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `createdById` INT NOT NULL,
  `maintenanceId` INT NULL,
  `incidentId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `MachineEvent_machineId_occurredAt_idx` (`machineId`,`occurredAt`),
  KEY `MachineEvent_createdById_idx` (`createdById`),
  CONSTRAINT `MachineEvent_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `MachineEvent_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
