const express = require('express');
const webhooks = require('./service');
const clientsService = require('../clients/service');
const manager = require('../sessions/manager');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/audit');

const router = express.Router();

// --- POST /api/webhooks/chatbot — público con secret por cliente ---
// Lo dejamos PRIMERO para que su ruta específica gane sobre el comodín
// `/:clientId/test` (que tiene `requireAdmin`).
router.post('/chatbot', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  const to = String(req.body?.to || '').trim();
  const text = String(req.body?.text || '').trim();

  if (!sessionId || !to || !text) {
    return res.status(400).json({ error: 'sessionId, to y text son requeridos' });
  }

  const clientId = await manager.lookupClientIdBySessionId(sessionId);
  if (!clientId) return res.status(404).json({ error: 'sessionId no existe' });

  const clientData = await clientsService.getClientWithSecrets(clientId);
  if (!clientData) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (!clientData.is_active) return res.status(403).json({ error: 'Cliente inactivo' });

  if (!webhooks.checkClientSecret(req, clientData.webhook_secret)) {
    return res.status(401).json({ error: 'Secret inválido' });
  }

  try {
    const result = await manager.sendMessage(sessionId, to, text);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// --- POST /api/webhooks/:clientId/test — admin: probar el webhook configurado en ese cliente ---
router.post('/:clientId/test', requireAdmin, async (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'clientId inválido' });
  }
  try {
    const cfg = await webhooks.getClientWebhookConfig(clientId);
    if (!cfg) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (!cfg.incomingUrl) {
      return res.status(400).json({ error: 'Este cliente no tiene webhook configurado' });
    }
    if (!webhooks.validateUrl(cfg.incomingUrl)) {
      return res.status(400).json({ error: 'URL del webhook inválida' });
    }
    const result = await webhooks.testIncoming(cfg.incomingUrl, cfg.secret);
    auditLog(req.adminId, 'webhook.test', 'client', String(clientId), { status: result.status }, req).catch(() => {});
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: webhooks.formatError(error) });
  }
});

module.exports = router;
