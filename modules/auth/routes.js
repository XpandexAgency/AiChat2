const express = require('express');
const authService = require('./service');
const { requireAdmin, COOKIE_NAME } = require('../../middleware/auth');
const { loginLimiter } = require('../../middleware/rate-limit');
const { auditLog } = require('../../middleware/audit');

const router = express.Router();

const COOKIE_OPTS_BASE = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
};

function cookieOptions(extra = {}) {
  return {
    ...COOKIE_OPTS_BASE,
    secure: process.env.NODE_ENV === 'production',
    ...extra,
  };
}

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  try {
    const { rawToken, adminId, expiresAt: exp } = await authService.login(email, password, req);
    res.cookie(COOKIE_NAME, rawToken, cookieOptions({ expires: exp }));
    auditLog(adminId, 'admin_login', 'admin', String(adminId), {}, req).catch(() => {});
    const admin = await authService.getAdmin(adminId);
    return res.json({ ok: true, admin });
  } catch (error) {
    auditLog(null, 'admin_login_failed', 'admin', null, { email }, req).catch(() => {});
    if (error.code === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    return res.status(500).json({ error: error.message });
  }
});

router.get('/me', requireAdmin, async (req, res) => {
  try {
    const admin = await authService.getAdmin(req.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin no encontrado' });
    return res.json(admin);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/logout', requireAdmin, async (req, res) => {
  const rawToken = req.cookies?.[COOKIE_NAME];
  try {
    await authService.destroySession(rawToken);
  } catch (error) {
    console.error('Error destruyendo sesión:', error.message);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  auditLog(req.adminId, 'admin_logout', 'admin', String(req.adminId), {}, req).catch(() => {});
  return res.json({ ok: true });
});

module.exports = router;
