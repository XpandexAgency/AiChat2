const express = require('express');
const manager = require('./manager');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/audit');

const router = express.Router();

router.use(requireAdmin);

router.get('/', (req, res) => {
  // Filtro opcional ?clientId=N
  const clientId = req.query.clientId ? Number(req.query.clientId) : null;
  if (clientId) {
    manager.listSessionsByClient(clientId)
      .then((list) => res.json(list))
      .catch((err) => res.status(500).json({ error: err.message }));
    return;
  }
  res.json(manager.listSessions());
});

router.get('/:sessionId', (req, res) => {
  const session = manager.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  return res.json(session);
});

router.post('/start', async (req, res) => {
  const clientId = Number(req.body?.clientId);
  const sessionId = String(req.body?.sessionId || '').trim();
  const mode = req.body?.mode === 'business' ? 'business' : 'normal';

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'clientId es requerido (entero positivo)' });
  }
  if (!sessionId) return res.status(400).json({ error: 'sessionId es requerido' });

  try {
    const session = await manager.startSession({ clientId, sessionId, mode });
    auditLog(req.adminId, 'session.start', 'wa_session', sessionId, { clientId, mode }, req).catch(() => {});
    return res.status(201).json(session);
  } catch (error) {
    if (error.code === 'VALIDATION') return res.status(400).json({ error: error.message });
    if (error.code === 'CLIENT_NOT_FOUND') return res.status(404).json({ error: error.message });
    if (error.code === 'CLIENT_INACTIVE') return res.status(409).json({ error: error.message });
    if (error.code === 'CONFLICT') return res.status(409).json({ error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:sessionId/stop', async (req, res) => {
  const ok = await manager.stopSession(req.params.sessionId);
  if (!ok) return res.status(404).json({ error: 'Sesión no encontrada' });
  auditLog(req.adminId, 'session.stop', 'wa_session', req.params.sessionId, {}, req).catch(() => {});
  return res.json({ ok: true });
});

router.delete('/:sessionId', async (req, res) => {
  const result = await manager.deleteSession(req.params.sessionId);
  auditLog(req.adminId, 'session.delete', 'wa_session', req.params.sessionId, {}, req).catch(() => {});
  return res.json(result);
});

module.exports = router;
