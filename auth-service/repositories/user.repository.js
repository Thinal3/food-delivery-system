const { getPool } = require('../config/database');

// Bind values separately from SQL so request data cannot become executable query text.
async function findByEmail(email) {
  const [rows] = await getPool().execute(
    `SELECT id AS user_id, name AS full_name, email, password_hash, role, status, created_at
     FROM users WHERE email = ? LIMIT 1`,
    [email],
  );

  return rows[0] || null;
}

async function findPublicById(userId) {
  // Public-user queries deliberately omit password_hash.
  const [rows] = await getPool().execute(
    `SELECT id AS user_id, name AS full_name, email, role, status, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );

  return rows[0] || null;
}

async function create({ fullName, email, passwordHash, role = 'CUSTOMER', status = 'ACTIVE' }) {
  const [result] = await getPool().execute(
    'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
    [fullName, email, passwordHash, role, status],
  );

  // Read the inserted row through the public projection instead of returning the hash.
  return findPublicById(result.insertId);
}

async function listPaginated(page, limit) {
  const offset = (page - 1) * limit;
  const [rows] = await getPool().execute(
    `SELECT id AS user_id, name AS full_name, email, role, status, created_at
     FROM users ORDER BY id LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const [countRows] = await getPool().query('SELECT COUNT(*) AS total FROM users');
  return {
    users: rows,
    page,
    limit,
    total: Number(countRows[0].total),
  };
}

async function updateRole(userId, role) {
  return updateUser(userId, 'role', role);
}

async function updateStatus(userId, status) {
  return updateUser(userId, 'status', status);
}

async function updateUser(userId, field, value) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    // Lock active admins first so simultaneous demotions cannot both remove the final admin.
    const [activeAdmins] = await connection.execute(
      "SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE",
    );
    const [targetRows] = await connection.execute(
      'SELECT id, role, status FROM users WHERE id = ? FOR UPDATE',
      [userId],
    );
    const target = targetRows[0];
    if (!target) {
      await connection.rollback();
      return { notFound: true };
    }

    const remainsActiveAdmin = field === 'role'
      ? value === 'ADMIN' && target.status === 'ACTIVE'
      : target.role === 'ADMIN' && value === 'ACTIVE';
    if (target.role === 'ADMIN' && target.status === 'ACTIVE'
      && !remainsActiveAdmin && activeAdmins.length <= 1) {
      await connection.rollback();
      return { lastActiveAdmin: true };
    }

    const column = field === 'role' ? 'role' : 'status';
    await connection.execute(`UPDATE users SET ${column} = ? WHERE id = ?`, [value, userId]);
    const [rows] = await connection.execute(
      `SELECT id AS user_id, name AS full_name, email, role, status, created_at
       FROM users WHERE id = ?`,
      [userId],
    );
    await connection.commit();
    return { user: rows[0] };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  findByEmail,
  findPublicById,
  create,
  listPaginated,
  updateRole,
  updateStatus,
};