CREATE TABLE `ProductLotConfig` (
  `productId` INT NOT NULL PRIMARY KEY,
  `majorLetter` CHAR(1) NOT NULL DEFAULT 'A',
  `minorLetter` CHAR(1) NOT NULL DEFAULT 'A',
  `version` INT NOT NULL DEFAULT 0,
  `updatedById` INT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `ProductLotConfig_product_fk` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ProductLotConfig_user_fk` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `ProductLotConfig` (`productId`,`majorLetter`,`minorLetter`)
SELECT p.id,COALESCE(LEFT(last.productionLot,1),'A'),COALESCE(SUBSTRING(last.productionLot,2,1),'A')
FROM `Product` p LEFT JOIN `Production` last ON last.id=(
  SELECT pr.id FROM `Production` pr WHERE pr.productId=p.id AND pr.status<>'CANCELLED'
    AND pr.recordOrigin='PRODUCTION' AND pr.productionLot REGEXP '^[A-Z]{2}[ABC][0-6][0-9]{4}m'
  ORDER BY pr.startedAt DESC,pr.id DESC LIMIT 1
);

CREATE TABLE `ProductLotHistory` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `productId` INT NOT NULL,
  `scope` VARCHAR(16) NOT NULL,
  `previousPrefix` CHAR(2) NOT NULL,
  `newPrefix` CHAR(2) NOT NULL,
  `previousCode` VARCHAR(191) NULL,
  `newCode` VARCHAR(191) NULL,
  `reason` VARCHAR(2000) NOT NULL,
  `changedById` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `ProductLotHistory_product_idx` (`productId`,`createdAt`),
  CONSTRAINT `ProductLotHistory_product_fk` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `ProductLotHistory_user_fk` FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ProductionLotAlias` (
  `productionId` INT NOT NULL,
  `historyId` INT NOT NULL,
  `oldCode` VARCHAR(191) NOT NULL,
  `oldLabel` VARCHAR(255) NULL,
  PRIMARY KEY (`productionId`,`historyId`),
  KEY `ProductionLotAlias_code_idx` (`oldCode`),
  CONSTRAINT `ProductionLotAlias_production_fk` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ProductionLotAlias_history_fk` FOREIGN KEY (`historyId`) REFERENCES `ProductLotHistory`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `Production` DROP INDEX `Production_productionLot_key`, ADD INDEX `Production_product_lot_idx` (`productId`,`productionLot`);
ALTER TABLE `ProductionLotAssociation` DROP INDEX `ProductionLotAssociation_internalCode_key`, ADD INDEX `ProductionLotAssociation_internalCode_idx` (`internalCode`);
ALTER TABLE `MachineDisplayOrder` MODIFY COLUMN `commercialLotId` INT NULL, ADD COLUMN `productId` INT NULL, ADD CONSTRAINT `MachineDisplayOrder_product_fk` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT;
UPDATE `MachineDisplayOrder` o JOIN `CommercialLot` c ON c.id=o.commercialLotId SET o.productId=c.productId;
