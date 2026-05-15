const authService = require('../modules/auth/service');

const COOKIE_NAME = 'session';

async function requireAdmin(req, res, next) {
  const rawToken = req.cookies?.[COOKIE_NAME];
  if (!rawToken) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    const session = await authService.validateSession(rawToken);
    if (!session) {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }
    req.adminId = session.adminId;
    next();
  } catch (error) {
    return res.status(500).json({ error: `Error validando sesión: ${error.message}` });
  }
}

module.exports = { requireAdmin, COOKIE_NAME };
