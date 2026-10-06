CREATE DATABASE IF NOT EXISTS food_delivery_restaurant
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE food_delivery_restaurant;

CREATE TABLE IF NOT EXISTS restaurants (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  address VARCHAR(255) NOT NULL,
  contact_number VARCHAR(32) NOT NULL,
  email VARCHAR(254) NOT NULL,
  cuisine_type VARCHAR(80) NOT NULL,
  opening_time TIME NULL,
  closing_time TIME NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  operating_status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'CLOSED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_restaurants_owner (owner_user_id, id),
  INDEX idx_restaurants_public (status, operating_status, cuisine_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  restaurant_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_category_restaurant_name UNIQUE (restaurant_id, name),
  CONSTRAINT uq_category_restaurant_id UNIQUE (restaurant_id, id),
  CONSTRAINT fk_category_restaurant FOREIGN KEY (restaurant_id)
    REFERENCES restaurants (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  INDEX idx_categories_restaurant (restaurant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  restaurant_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  price DECIMAL(10,2) NOT NULL,
  availability TINYINT(1) NOT NULL DEFAULT 1,
  image_url VARCHAR(2048) NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_menu_item_price CHECK (price > 0),
  CONSTRAINT fk_menu_item_category FOREIGN KEY (category_id)
    REFERENCES menu_categories (id) ON DELETE SET NULL ON UPDATE RESTRICT,
  INDEX idx_menu_restaurant_visible (restaurant_id, deleted_at, category_id),
  INDEX idx_menu_category_visible (restaurant_id, category_id, deleted_at, availability)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;