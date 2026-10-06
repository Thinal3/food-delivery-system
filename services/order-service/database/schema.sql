CREATE DATABASE IF NOT EXISTS food_delivery_order
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE food_delivery_order;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT UNSIGNED NOT NULL,
  customer_user_id INT UNSIGNED NOT NULL,
  restaurant_id INT UNSIGNED NOT NULL,
  restaurant_owner_user_id INT UNSIGNED NULL,
  delivery_address JSON NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_orders_customer_user (customer_user_id, created_at, id),
  INDEX idx_orders_customer_profile (customer_id, created_at, id),
  INDEX idx_orders_restaurant_status (restaurant_id, status, created_at, id),
  INDEX idx_orders_status (status, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  menu_item_id INT UNSIGNED NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_order_item_quantity CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT chk_order_item_unit_price CHECK (unit_price > 0),
  CONSTRAINT chk_order_item_total_price CHECK (total_price > 0),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  INDEX idx_order_items_order (order_id, id),
  INDEX idx_order_items_menu (menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;