const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../../db/pool');

const SESSION_TTL_DAYS = 7;
const TOKEN_BYTES = 32; // → 64 hex chars

function generateRawToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function expiresAt() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
}

async function findAdminByEmail(email) {
  const [rows] = await pool.execute(
    'SELECT id, email, password_hash FROM admins WHERE email = ?',
    [email],
  );
  return rows[0] || null;
}

async function login(email, password, req) {
  const admin = await findAdminByEmail(email);
  // Constant-ish time: bcrypt.compare against dummy if user missing.
  // bcrypt automatically delays a few ms on any compare.
  const hashToCheck = admin?.password_hash || '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';
  const ok = await bcrypt.compare(password, hashToCheck);
  if (!admin || !ok) {
    const error = new Error('Invalid email or password');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const exp = expiresAt();
  const ua = req?.header?.('user-agent')?.slice(0, 500) || null;
  const ip = (req?.ip || req?.socket?.remoteAddress || '').slice(0, 45) || null;

  await pool.execute(
    'INSERT INTO admin_sessions (token_hash, admin_id, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ?)',
    [tokenHash, admin.id, ua, ip, exp],
  );

  return { rawToken, adminId: admin.id, expiresAt: exp };
}

async function validateSession(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = hashToken(rawToken);
  const [rows] = await pool.execute(
    'SELECT admin_id, expires_at FROM admin_sessions WHERE token_hash = ?',
    [tokenHash],
  );
  if (rows.length === 0) return null;
  const session = rows[0];
  if (new Date(session.expires_at) <= new Date()) {
    // Expired — clean it up opportunistically
    pool.execute('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]).catch(() => {});
    return null;
  }
  return { adminId: session.admin_id };
}

async function destroySession(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await pool.execute('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
}

async function getAdmin(adminId) {
  const [rows] = await pool.execute(
    'SELECT id, email, created_at FROM admins WHERE id = ?',
    [adminId],
  );
  return rows[0] || null;
}

async function cleanupExpiredSessions() {
  try {
    const [result] = await pool.execute('DELETE FROM admin_sessions WHERE expires_at < NOW()');
    if (result.affectedRows > 0) {
      console.log(`Cleaned up ${result.affectedRows} expired admin sessions`);
    }
  } catch (error) {
    console.error('Error cleaning expired sessions:', error.message);
  }
}

module.exports = {
  login,
  validateSession,
  destroySession,
  getAdmin,
  cleanupExpiredSessions,
  SESSION_TTL_DAYS,
};
