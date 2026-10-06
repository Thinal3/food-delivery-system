CREATE DATABASE IF NOT EXISTS food_delivery_delivery
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE food_delivery_delivery;

CREATE TABLE IF NOT EXISTS deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  delivery_person_id INT UNSIGNED NULL,
  restaurant_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  customer_user_id INT UNSIGNED NOT NULL,
  restaurant_owner_user_id INT UNSIGNED NOT NULL,
  pickup_address JSON NOT NULL,
  delivery_address JSON NOT NULL,
  status ENUM('PENDING', 'ASSIGNED', 'PICKUP_PENDING', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  assigned_at TIMESTAMP NULL,
  pickup_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  failed_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  failure_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_deliveries_order UNIQUE (order_id),
  INDEX idx_deliveries_person_status (delivery_person_id, status, created_at, id),
  INDEX idx_deliveries_restaurant_status (restaurant_id, status, created_at, id),
  INDEX idx_deliveries_customer_user (customer_user_id, created_at, id),
  INDEX idx_deliveries_status (status, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_order_sync (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  delivery_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  target_status ENUM('PICKED_UP', 'ON_THE_WAY', 'DELIVERED') NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  state ENUM('PENDING', 'PROCESSING', 'SYNCED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMP NULL,
  last_error VARCHAR(300) NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_delivery_sync_delivery FOREIGN KEY (delivery_id)
    REFERENCES deliveries (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT uq_delivery_sync_event UNIQUE (delivery_id, target_status),
  INDEX idx_delivery_sync_pending (completed_at, available_at, id, order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;