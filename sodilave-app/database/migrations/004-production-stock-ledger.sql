CREATE TABLE IF NOT EXISTS `ProductionStockConsumption` (
  `productionId` INT NOT NULL,
  `rawMaterialLotId` INT NOT NULL,
  `quantityKg` DECIMAL(12,3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`productionId`,`rawMaterialLotId`),
  KEY `ProductionStockConsumption_rawMaterialLotId_idx` (`rawMaterialLotId`),
  CONSTRAINT `ProductionStockConsumption_productionId_fkey` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductionStockConsumption_rawMaterialLotId_fkey` FOREIGN KEY (`rawMaterialLotId`) REFERENCES `RawMaterialLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
