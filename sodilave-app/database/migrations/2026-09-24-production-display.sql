CREATE TABLE IF NOT EXISTS ProductionDisplayDevice (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  pairingHash CHAR(64) NULL UNIQUE,
  pairingExpiresAt DATETIME(3) NOT NULL,
  tokenHash CHAR(64) NULL UNIQUE,
  expiresAt DATETIME(3) NULL,
  revokedAt DATETIME(3) NULL,
  createdById INT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT ProductionDisplayDevice_creator_fk FOREIGN KEY (createdById) REFERENCES User(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS MachineDisplayOrder (
  machineId INT NOT NULL PRIMARY KEY,
  weeklyStartupId INT NOT NULL,
  commercialLotId INT NOT NULL,
  destination VARCHAR(16) NOT NULL,
  notes VARCHAR(240) NOT NULL DEFAULT '',
  updatedById INT NOT NULL,
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT MachineDisplayOrder_machine_fk FOREIGN KEY (machineId) REFERENCES Machine(id) ON DELETE RESTRICT,
  CONSTRAINT MachineDisplayOrder_startup_fk FOREIGN KEY (weeklyStartupId) REFERENCES WeeklyStartup(id) ON DELETE RESTRICT,
  CONSTRAINT MachineDisplayOrder_lot_fk FOREIGN KEY (commercialLotId) REFERENCES CommercialLot(id) ON DELETE RESTRICT,
  CONSTRAINT MachineDisplayOrder_user_fk FOREIGN KEY (updatedById) REFERENCES User(id) ON DELETE RESTRICT,
  CONSTRAINT MachineDisplayOrder_destination_chk CHECK (destination IN ('PALLET','STACK'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
