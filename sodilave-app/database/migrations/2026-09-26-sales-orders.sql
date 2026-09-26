CREATE TABLE IF NOT EXISTS SalesOrder (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customerName VARCHAR(191) NOT NULL,
  customerReference VARCHAR(191) NULL,
  orderDate DATE NOT NULL,
  notes VARCHAR(1500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  requestId CHAR(36) NOT NULL UNIQUE,
  requestHash CHAR(64) NOT NULL,
  createdById INT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cancelledAt DATETIME(3) NULL,
  cancelReason VARCHAR(500) NULL,
  KEY SalesOrder_date_idx (orderDate,id),
  CONSTRAINT SalesOrder_user_fk FOREIGN KEY (createdById) REFERENCES User(id) ON DELETE RESTRICT,
  CONSTRAINT SalesOrder_status_chk CHECK (status IN ('OPEN','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SalesOrderItem (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  salesOrderId INT NOT NULL,
  productId INT NOT NULL,
  productCode VARCHAR(191) NOT NULL,
  productName VARCHAR(191) NOT NULL,
  quantityUnits INT NOT NULL,
  unitPrice DECIMAL(12,4) NOT NULL,
  UNIQUE KEY SalesOrderItem_product_key (salesOrderId,productId),
  CONSTRAINT SalesOrderItem_order_fk FOREIGN KEY (salesOrderId) REFERENCES SalesOrder(id) ON DELETE RESTRICT,
  CONSTRAINT SalesOrderItem_product_fk FOREIGN KEY (productId) REFERENCES Product(id) ON DELETE RESTRICT,
  CONSTRAINT SalesOrderItem_quantity_chk CHECK (quantityUnits>0),
  CONSTRAINT SalesOrderItem_price_chk CHECK (unitPrice>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE LotDispatch ADD COLUMN salesOrderItemId INT NULL,
  ADD COLUMN requestId CHAR(36) NULL,
  ADD COLUMN requestHash CHAR(64) NULL,
  ADD UNIQUE KEY LotDispatch_request_key (requestId),
  ADD KEY LotDispatch_order_item_idx (salesOrderItemId),
  ADD CONSTRAINT LotDispatch_order_item_fk FOREIGN KEY (salesOrderItemId) REFERENCES SalesOrderItem(id) ON DELETE RESTRICT;
