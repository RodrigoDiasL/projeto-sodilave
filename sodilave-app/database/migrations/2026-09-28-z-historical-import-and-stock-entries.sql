CREATE TABLE `OpeningStockRequest` (
  `requestId` CHAR(36) NOT NULL PRIMARY KEY,
  `requestHash` CHAR(64) NOT NULL,
  `productionId` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `OpeningStockRequest_production_fk` FOREIGN KEY (`productionId`) REFERENCES `Production` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `HistoricalImportBatch` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `fileName` VARCHAR(200) NOT NULL,
  `fileHash` CHAR(64) NOT NULL,
  `importedById` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `HistoricalImportBatch_hash_idx` (`fileHash`),
  CONSTRAINT `HistoricalImportBatch_user_fk` FOREIGN KEY (`importedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `HistoricalImportItem` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `batchId` INT NOT NULL,
  `productionId` INT NOT NULL,
  `recordKey` CHAR(64) NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `payloadJson` JSON NOT NULL,
  UNIQUE KEY `HistoricalImportItem_record_key` (`recordKey`),
  UNIQUE KEY `HistoricalImportItem_production_key` (`productionId`),
  CONSTRAINT `HistoricalImportItem_batch_fk` FOREIGN KEY (`batchId`) REFERENCES `HistoricalImportBatch` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `HistoricalImportItem_production_fk` FOREIGN KEY (`productionId`) REFERENCES `Production` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
