CREATE TABLE IF NOT EXISTS `OperationSettings` (
  `id` INT NOT NULL,
  `pastProductionEnabled` TINYINT(1) NOT NULL DEFAULT 0,
  `updatedById` INT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `OperationSettings` (`id`, `pastProductionEnabled`) VALUES (1, 0);

ALTER TABLE `ShiftGeneralCheck`
  ADD COLUMN `purgePneumaticBarrels` TINYINT(1) NULL DEFAULT NULL,
  ADD COLUMN `purgeCleanAirBarrels` TINYINT(1) NULL DEFAULT NULL,
  ADD COLUMN `purgeFilters` TINYINT(1) NULL DEFAULT NULL;
