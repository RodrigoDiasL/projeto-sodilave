ALTER TABLE `WeeklyStartup`
  ADD COLUMN `coolingPump1` TINYINT(1) NOT NULL DEFAULT 0 AFTER `coolingPump`,
  ADD COLUMN `coolingPump2` TINYINT(1) NOT NULL DEFAULT 0 AFTER `coolingPump1`;

UPDATE `WeeklyStartup`
SET `coolingPump1` = `coolingPump`,
    `coolingPump2` = `coolingPump`
WHERE `coolingPump` = 1;

CREATE TABLE IF NOT EXISTS `ShiftPeerConfirmation` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `operatorId` INT NOT NULL,
  `confirmedById` INT NOT NULL,
  `shiftCode` VARCHAR(8) NOT NULL,
  `shiftStart` DATETIME(3) NOT NULL,
  `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ShiftPeerConfirmation_operator_shift_key` (`operatorId`,`shiftStart`),
  KEY `ShiftPeerConfirmation_confirmedById_idx` (`confirmedById`),
  CONSTRAINT `ShiftPeerConfirmation_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ShiftPeerConfirmation_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
