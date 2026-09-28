ALTER TABLE `Product` ADD COLUMN `stockFamily` VARCHAR(80) NULL;
UPDATE `StorageLocation` SET warehouseName='Armazém Sede' WHERE warehouseCode='W1';
UPDATE `StorageLocation` SET warehouseName='Armazém Zona Industrial' WHERE warehouseCode='W2';
