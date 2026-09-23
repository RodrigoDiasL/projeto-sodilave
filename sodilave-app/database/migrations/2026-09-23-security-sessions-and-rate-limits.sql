ALTER TABLE `User` ADD COLUMN `sessionVersion` INT NOT NULL DEFAULT 1;

CREATE TABLE `AuthSession` (
  `id` CHAR(36) NOT NULL,
  `userId` INT NOT NULL,
  `sessionVersion` INT NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `AuthSession_expiry_idx` (`expiresAt`),
  KEY `AuthSession_user_idx` (`userId`),
  CONSTRAINT `AuthSession_user_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AuthRateLimit` (
  `bucket` VARCHAR(100) NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `resetAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`bucket`),
  KEY `AuthRateLimit_expiry_idx` (`resetAt`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CredentialLock` (
  `id` INT NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
INSERT INTO `CredentialLock` (`id`) VALUES (1);
