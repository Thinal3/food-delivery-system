const { getPool } = require('../config/database');

const COLUMNS = `id, order_id, delivery_person_id, restaurant_id, customer_id,
  customer_user_id, restaurant_owner_user_id, pickup_address, delivery_address,
  status, assigned_at, pickup_at, delivered_at, failed_at, cancelled_at,
  failure_reason, created_at, updated_at`;

function normalize(row) {
  if (!row) return null;
  for (const field of ['pickup_address', 'delivery_address']) {
    if (typeof row[field] === 'string') {
      try { row[field] = JSON.parse(row[field]); } catch { /* preserve malformed legacy snapshot */ }
    }
  }
  return row;
}

async function findById(id) {
  const [rows] = await getPool().execute(`SELECT ${COLUMNS} FROM deliveries WHERE id = ? LIMIT 1`, [id]);
  return normalize(rows[0]);
}

async function findByOrderId(orderId) {
  const [rows] = await getPool().execute(`SELECT ${COLUMNS} FROM deliveries WHERE order_id = ? LIMIT 1`, [orderId]);
  return normalize(rows[0]);
}

async function create(input) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO deliveries
       (order_id, delivery_person_id, restaurant_id, customer_id, customer_user_id,
        restaurant_owner_user_id, pickup_address, delivery_address, status)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [input.orderId, input.restaurantId, input.customerId, input.customerUserId,
        input.restaurantOwnerUserId, JSON.stringify(input.pickupAddress), JSON.stringify(input.deliveryAddress)],
    );
    const [rows] = await connection.execute(`SELECT ${COLUMNS} FROM deliveries WHERE id = ?`, [result.insertId]);
    await connection.commit();
    return normalize(rows[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function listWhere(where, values, { page, limit }) {
  const offset = (page - 1) * limit;
  const [rows] = await getPool().execute(
    `SELECT ${COLUMNS} FROM deliveries WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  const [counts] = await getPool().execute(`SELECT COUNT(*) AS total FROM deliveries WHERE ${where}`, values);
  return { deliveries: rows.map(normalize), page, limit, total: Number(counts[0].total) };
}

async function listForPerson(userId, query) {
  return listWhere(query.status
    ? 'delivery_person_id = ? AND status = ?'
    : 'delivery_person_id = ?',
  query.status ? [userId, query.status] : [userId], query);
}

async function listForRestaurant(restaurantId, query) {
  return listWhere(query.status
    ? 'restaurant_id = ? AND status = ?'
    : 'restaurant_id = ?',
  query.status ? [restaurantId, query.status] : [restaurantId], query);
}

async function listForCustomer(customerUserId, query) {
  return listWhere(query.status
    ? 'customer_user_id = ? AND status = ?'
    : 'customer_user_id = ?',
  query.status ? [customerUserId, query.status] : [customerUserId], query);
}

async function listAll(query) {
  return listWhere(query.status ? 'status = ?' : '1 = 1', query.status ? [query.status] : [], query);
}

async function updateAssignment(id, deliveryPersonId, expectedStatuses) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT status FROM deliveries WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) { await connection.rollback(); return { notFound: true }; }
    const status = rows[0].status;
    if (!expectedStatuses.includes(status)) { await connection.rollback(); return { conflict: true }; }
    const nextStatus = status === 'PENDING' ? 'ASSIGNED' : status;
    await connection.execute(
      `UPDATE deliveries SET delivery_person_id = ?, status = ?, assigned_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = ?`, [deliveryPersonId, nextStatus, id, status],
    );
    const [updated] = await connection.execute(`SELECT ${COLUMNS} FROM deliveries WHERE id = ?`, [id]);
    await connection.commit();
    return { delivery: normalize(updated[0]) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function transition(id, nextStatus, { expectedStatus, failureReason = null } = {}) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`SELECT ${COLUMNS} FROM deliveries WHERE id = ? FOR UPDATE`, [id]);
    const current = rows[0];
    if (!current) { await connection.rollback(); return { notFound: true }; }
    if (expectedStatus && current.status !== expectedStatus) { await connection.rollback(); return { conflict: true }; }
    const timestampColumn = {
      PICKED_UP: 'pickup_at', DELIVERED: 'delivered_at', FAILED: 'failed_at', CANCELLED: 'cancelled_at',
    }[nextStatus];
    const assignments = ['status = ?'];
    const values = [nextStatus];
    if (timestampColumn) assignments.push(`${timestampColumn} = CURRENT_TIMESTAMP`);
    if (nextStatus === 'FAILED') { assignments.push('failure_reason = ?'); values.push(failureReason); }
    await connection.execute(
      `UPDATE deliveries SET ${assignments.join(', ')} WHERE id = ? AND status = ?`,
      [...values, id, current.status],
    );
    if (['PICKED_UP', 'ON_THE_WAY', 'DELIVERED'].includes(nextStatus)) {
      await connection.execute(
        `INSERT INTO delivery_order_sync (delivery_id, order_id, target_status, state)
         VALUES (?, ?, ?, 'PENDING')`, [id, current.order_id, nextStatus],
      );
    }
    const [updated] = await connection.execute(`SELECT ${COLUMNS} FROM deliveries WHERE id = ?`, [id]);
    await connection.commit();
    return { delivery: normalize(updated[0]) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function claimNextSyncTask() {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE delivery_order_sync SET state = 'PENDING', claimed_at = NULL
       WHERE state = 'PROCESSING' AND claimed_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 60 SECOND)`,
    );
    const [tasks] = await connection.query(
      `SELECT task.id, task.delivery_id, task.order_id, task.target_status, task.attempts
       FROM delivery_order_sync task
       WHERE task.state = 'PENDING' AND task.available_at <= CURRENT_TIMESTAMP
         AND NOT EXISTS (
           SELECT 1 FROM delivery_order_sync earlier
           WHERE earlier.order_id = task.order_id AND earlier.id < task.id AND earlier.state <> 'SYNCED'
         )
       ORDER BY task.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!tasks.length) { await connection.commit(); return null; }
    await connection.execute(
      `UPDATE delivery_order_sync SET state = 'PROCESSING', claimed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND state = 'PENDING'`, [tasks[0].id],
    );
    await connection.commit();
    return tasks[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function markSyncSucceeded(taskId) {
  await getPool().execute(
    `UPDATE delivery_order_sync SET state = 'SYNCED', completed_at = CURRENT_TIMESTAMP,
     claimed_at = NULL, last_error = NULL WHERE id = ? AND state = 'PROCESSING'`, [taskId],
  );
}

async function markSyncFailed(task, errorCode, maxAttempts) {
  const attempts = Number(task.attempts) + 1;
  const failed = attempts >= maxAttempts;
  const delaySeconds = Math.min(2 ** attempts, 300);
  await getPool().execute(
    `UPDATE delivery_order_sync
     SET attempts = ?, state = ?, claimed_at = NULL,
         available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
         last_error = ?, completed_at = IF(? = 'FAILED', CURRENT_TIMESTAMP, NULL)
     WHERE id = ? AND state = 'PROCESSING'`,
    [attempts, failed ? 'FAILED' : 'PENDING', delaySeconds, errorCode, failed ? 'FAILED' : 'PENDING', task.id],
  );
}

async function getAssignmentByOrderId(orderId) {
  const [rows] = await getPool().execute(
    `SELECT id, order_id, delivery_person_id, status FROM deliveries WHERE order_id = ? LIMIT 1`, [orderId],
  );
  return rows[0] || null;
}

async function getInternalStatus(orderId) {
  const [rows] = await getPool().execute(
    `SELECT id, order_id, delivery_person_id, status FROM deliveries WHERE order_id = ? LIMIT 1`, [orderId],
  );
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await getPool().execute(`SELECT ${COLUMNS} FROM deliveries WHERE id = ? LIMIT 1`, [id]);
  return normalize(rows[0]);
}

async function findByOrderId(orderId) {
  const [rows] = await getPool().execute(`SELECT ${COLUMNS} FROM deliveries WHERE order_id = ? LIMIT 1`, [orderId]);
  return normalize(rows[0]);
}

module.exports = {
  create, findById, findByOrderId, listForPerson, listForRestaurant, listForCustomer, listAll,
  updateAssignment, transition, claimNextSyncTask, markSyncSucceeded, markSyncFailed,
  getAssignmentByOrderId, getInternalStatus,
};