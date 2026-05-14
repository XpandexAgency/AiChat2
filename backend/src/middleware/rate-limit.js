const rateLimit = require('express-rate-limit');

// 5/15min en producción (defensivo), 50/15min en dev para no chocar
// mientras se prueba. Override explícito vía LOGIN_RATE_MAX.
const isProd = process.env.NODE_ENV === 'production';
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_MAX) || (isProd ? 5 : 50);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
  },
  handler(_req, res) {
    res.status(429).json({
      error: 'Demasiados intentos de login. Inténtalo en unos minutos.',
    });
  },
});

module.exports = { loginLimiter };
