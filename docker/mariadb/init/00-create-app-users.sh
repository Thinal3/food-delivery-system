#!/bin/sh
set -eu

# Password values are deliberately constrained to hexadecimal strings. The README
# supplies a Node crypto command that produces this safe format, so no shell or SQL
# interpolation can introduce quote characters into these statements.
for value in "$AUTH_DB_PASSWORD" "$RESTAURANT_DB_PASSWORD" "$ORDER_DB_PASSWORD" "$DELIVERY_DB_PASSWORD" "$CUSTOMER_DB_PASSWORD"; do
  case "$value" in
    *[!0123456789abcdefABCDEF]*|'') echo "Application database passwords must be non-empty hexadecimal values." >&2; exit 1 ;;
  esac
done

mariadb --protocol=socket -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CREATE USER IF NOT EXISTS 'food_auth_app'@'%' IDENTIFIED BY '${AUTH_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'food_restaurant_app'@'%' IDENTIFIED BY '${RESTAURANT_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'food_order_app'@'%' IDENTIFIED BY '${ORDER_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'food_delivery_app'@'%' IDENTIFIED BY '${DELIVERY_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'food_customer_app'@'%' IDENTIFIED BY '${CUSTOMER_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_auth.* TO 'food_auth_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_restaurant.* TO 'food_restaurant_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_order.* TO 'food_order_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_delivery.* TO 'food_delivery_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_customer.* TO 'food_customer_app'@'%';
FLUSH PRIVILEGES;
SQL
