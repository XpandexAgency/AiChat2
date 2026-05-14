const pool = require('../../db/pool');

async function getAuditLogs(filters = {}) {
  const connection = await pool.getConnection();
  try {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (filters.adminId) {
      query += ' AND admin_id = ?';
      params.push(filters.adminId);
    }

    if (filters.action) {
      query += ' AND action = ?';
      params.push(filters.action);
    }

    if (filters.startDate) {
      query += ' AND created_at >= ?';
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      query += ' AND created_at <= ?';
      params.push(filters.endDate);
    }

    query += ' ORDER BY created_at DESC LIMIT 1000';

    const [rows] = await connection.execute(query, params);
    return rows;
  } finally {
    connection.release();
  }
}

module.exports = { getAuditLogs };
