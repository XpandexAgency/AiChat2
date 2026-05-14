const pool = require('../db/pool');

async function auditLog(adminId, action, resourceType, resourceId, details, req) {
  try {
    const connection = await pool.getConnection();
    const ip = req.ip || req.connection.remoteAddress || '';
    const userAgent = req.header('user-agent') || '';

    await connection.execute(
      'INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [adminId, action, resourceType, resourceId, JSON.stringify(details || {}), ip, userAgent],
    );

    connection.release();
  } catch (error) {
    console.error('Error writing audit log:', error.message);
  }
}

module.exports = { auditLog };
