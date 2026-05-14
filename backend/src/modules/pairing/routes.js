const express = require('express');
const rateLimit = require('express-rate-limit');
const clientsService = require('../clients/service');
const sessionsManager = require('../sessions/manager');

const router = express.Router();

// Rate limit defensivo en endpoints públicos (sin auth de admin)
const pairingLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 min
  max: 60,                    // 60 req/min/IP — suficiente para polling cada 2s desde una pestaña
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
  },
  handler(_req, res) {
    res.status(429).json({ error: 'Demasiadas peticiones. Intenta de nuevo en un momento.' });
  },
});

router.use(pairingLimiter);

// Serializa SOLO lo que el cliente final debe ver: nombre, estado, sesiones.
// NUNCA exponer email/teléfono/webhook/tags/admin info aquí.
function serializeForClient(client, sessions) {
  return {
    client: {
      id: client.id,
      name: client.name,
      isActive: client.isActive,
    },
    sessions: (sessions || []).map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      qrDataUrl: s.qrDataUrl,
      connectedNumber: s.connectedNumber,
      lastError: s.lastError,
    })),
  };
}

// GET /api/pairing/:token — info del cliente + sesiones (público)
router.get('/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length < 32) {
    return res.status(404).json({ error: 'Enlace no válido' });
  }
  try {
    const client = await clientsService.findByPairingToken(token);
    if (!client) return res.status(404).json({ error: 'Enlace no válido' });
    const sessions = await sessionsManager.listSessionsByClient(client.id);
    return res.json(serializeForClient(client, sessions));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/pairing/:token/sessions — arranca una sesión "main" para este cliente
// (auto self-service: el cliente pulsa "Iniciar vinculación" en el frontend público).
// Si ya existe una sesión activa, devuelve el estado actual sin recrearla.
router.post('/:token/sessions', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length < 32) {
    return res.status(404).json({ error: 'Enlace no válido' });
  }
  try {
    const client = await clientsService.findByPairingToken(token);
    if (!client) return res.status(404).json({ error: 'Enlace no válido' });
    if (!client.isActive) return res.status(403).json({ error: 'Cuenta inactiva. Contacta con tu administrador.' });

    const existing = await sessionsManager.listSessionsByClient(client.id);
    const live = existing.find((s) => s.status !== 'stopped' && s.status !== 'auth_failure');
    if (live) {
      const sessions = await sessionsManager.listSessionsByClient(client.id);
      return res.json(serializeForClient(client, sessions));
    }

    // sessionId determinístico para este cliente: 'client-<id>-main' evita choques entre clientes
    const sessionId = `client-${client.id}-main`;
    await sessionsManager.startSession({
      clientId: client.id,
      sessionId,
      mode: 'normal',
    });
    const sessions = await sessionsManager.listSessionsByClient(client.id);
    return res.json(serializeForClient(client, sessions));
  } catch (error) {
    if (error.code === 'CLIENT_INACTIVE') {
      return res.status(403).json({ error: 'Cuenta inactiva. Contacta con tu administrador.' });
    }
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
