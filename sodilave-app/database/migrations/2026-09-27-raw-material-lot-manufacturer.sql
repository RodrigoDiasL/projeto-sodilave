ALTER TABLE `RawMaterialLot` ADD COLUMN `manufacturer` VARCHAR(191) NULL;

UPDATE `RawMaterialLot` AS lot
INNER JOIN `RawMaterial` AS material ON material.id = lot.rawMaterialId
SET lot.manufacturer = material.manufacturer
WHERE lot.manufacturer IS NULL AND material.manufacturer IS NOT NULL;
