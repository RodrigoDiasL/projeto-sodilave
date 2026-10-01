CREATE TABLE IF NOT EXISTS `HistoricalImportCheckItem` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `batchId` INT NOT NULL,
  `entity` VARCHAR(32) NOT NULL,
  `entityId` INT NOT NULL,
  `recordKey` CHAR(64) NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `payloadJson` JSON NOT NULL,
  UNIQUE KEY `HistoricalImportCheckItem_record_key` (`recordKey`),
  KEY `HistoricalImportCheckItem_entity_idx` (`entity`,`entityId`),
  KEY `HistoricalImportCheckItem_batch_idx` (`batchId`),
  CONSTRAINT `HistoricalImportCheckItem_batch_fk`
    FOREIGN KEY (`batchId`) REFERENCES `HistoricalImportBatch` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
