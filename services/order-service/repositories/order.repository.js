const { getPool } = require('../config/database');

const ORDER_COLUMNS = `id, customer_id, customer_user_id, restaurant_id,
  restaurant_owner_user_id, delivery_address, CAST(subtotal AS CHAR) AS subtotal,
  CAST(delivery_fee AS CHAR) AS delivery_fee, CAST(total_amount AS CHAR) AS total_amount,
  status, created_at, updated_at`;
const ITEM_COLUMNS = `id, order_id, menu_item_id, item_name, quantity,
  CAST(unit_price AS CHAR) AS unit_price, CAST(total_price AS CHAR) AS total_price`;

function normalizeOrder(row) {
  if (!row) return null;
  if (typeof row.delivery_address === 'string') {
    try { row.delivery_address = JSON.parse(row.delivery_address); } catch { /* returned as stored if old data is invalid */ }
  }
  return row;
}

async function insertOrderWithItems(order, items) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [insert] = await connection.execute(
      `INSERT INTO orders
       (customer_id, customer_user_id, restaurant_id, restaurant_owner_user_id,
        delivery_address, subtotal, delivery_fee, total_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [order.customerId, order.customerUserId, order.restaurantId,
        order.restaurantOwnerUserId, JSON.stringify(order.deliveryAddress),
        order.subtotal, order.deliveryFee, order.totalAmount],
    );
    const orderId = Number(insert.insertId);
    for (const item of items) {
      await connection.execute(
        `INSERT INTO order_items
         (order_id, menu_item_id, item_name, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, item.menuItemId, item.itemName, item.quantity, item.unitPrice, item.totalPrice],
      );
    }
    await connection.commit();
    return findById(orderId, { connection: getPool() });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findById(id, { connection = getPool() } = {}) {
  const [orders] = await connection.execute(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ? LIMIT 1`, [id]);
  if (!orders.length) return null;
  const [items] = await connection.execute(`SELECT ${ITEM_COLUMNS} FROM order_items WHERE order_id = ? ORDER BY id`, [id]);
  return { ...normalizeOrder(orders[0]), items };
}

async function listWhere(where, values, { page, limit }) {
  const offset = (page - 1) * limit;
  const [rows] = await getPool().execute(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  const [countRows] = await getPool().execute(`SELECT COUNT(*) AS total FROM orders WHERE ${where}`, values);
  if (!rows.length) return { orders: [], page, limit, total: Number(countRows[0].total) };
  const ids = rows.map((row) => Number(row.id));
  const placeholders = ids.map(() => '?').join(', ');
  const [itemRows] = await getPool().execute(
    `SELECT ${ITEM_COLUMNS} FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, id`, ids,
  );
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const item of itemRows) byOrder.get(Number(item.order_id)).push(item);
  return {
    orders: rows.map((row) => ({ ...normalizeOrder(row), items: byOrder.get(Number(row.id)) })),
    page,
    limit,
    total: Number(countRows[0].total),
  };
}

function withStatusFilter(column, id, query) {
  if (query.status) return listWhere(`${column} = ? AND status = ?`, [id, query.status], query);
  return listWhere(`${column} = ?`, [id], query);
}

async function listForCustomer(userId, query) {
  return withStatusFilter('customer_user_id', userId, query);
}

async function listForRestaurant(restaurantId, query) {
  return withStatusFilter('restaurant_id', restaurantId, query);
}

async function listAll(query) {
  if (query.status) return listWhere('status = ?', [query.status], query);
  return listWhere('1 = 1', [], query);
}

async function transitionIfCurrent(id, currentStatus, nextStatus) {
  const [result] = await getPool().execute(
    'UPDATE orders SET status = ? WHERE id = ? AND status = ?',
    [nextStatus, id, currentStatus],
  );
  return result.affectedRows === 1;
}

module.exports = {
  insertOrderWithItems,
  findById,
  listForCustomer,
  listForRestaurant,
  listAll,
  transitionIfCurrent,
};