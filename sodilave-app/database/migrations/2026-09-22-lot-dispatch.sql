ALTER TABLE `Production`
  ADD COLUMN `unitsPerPackageSnapshot` INT NULL AFTER `quantityProduced`;

UPDATE `Production` p
INNER JOIN `Product` pr ON pr.id = p.productId
SET p.unitsPerPackageSnapshot = pr.unitsPerPackage
WHERE p.unitsPerPackageSnapshot IS NULL
  AND pr.unitsPerPackage IS NOT NULL;

CREATE TABLE IF NOT EXISTS `LotDispatch` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `customerName` VARCHAR(191) NOT NULL,
  `orderReference` VARCHAR(191) NOT NULL,
  `invoiceNumber` VARCHAR(191) NOT NULL,
  `productId` INT NOT NULL,
  `orderedQuantityUnits` INT NOT NULL,
  `dispatchDate` DATE NOT NULL,
  `createdById` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `cancelledAt` DATETIME(3) NULL,
  `cancelledById` INT NULL,
  `cancelReason` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `LotDispatch_product_date_idx` (`productId`,`dispatchDate`),
  KEY `LotDispatch_order_idx` (`orderReference`),
  KEY `LotDispatch_invoice_idx` (`invoiceNumber`),
  KEY `LotDispatch_createdById_idx` (`createdById`),
  CONSTRAINT `LotDispatch_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `LotDispatch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `LotDispatch_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `LotDispatchLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `lotDispatchId` INT NOT NULL,
  `productionId` INT NOT NULL,
  `quantityUnits` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `LotDispatchLine_dispatch_production_key` (`lotDispatchId`,`productionId`),
  KEY `LotDispatchLine_productionId_idx` (`productionId`),
  CONSTRAINT `LotDispatchLine_lotDispatchId_fkey` FOREIGN KEY (`lotDispatchId`) REFERENCES `LotDispatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LotDispatchLine_productionId_fkey` FOREIGN KEY (`productionId`) REFERENCES `Production`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
