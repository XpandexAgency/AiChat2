const express = require('express');
const clientsService = require('./service');
const sessionsManager = require('../sessions/manager');
const { requireAdmin } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/audit');

const router = express.Router();

router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    const list = await clientsService.listClients({ activeOnly });
    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
  try {
    const client = await clientsService.getClient(id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    return res.json(client);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const client = await clientsService.createClient(req.body || {}, req.adminId);
    auditLog(req.adminId, 'client.create', 'client', String(client.id), { name: client.name }, req).catch(() => {});
    return res.status(201).json(client);
  } catch (error) {
    if (error.code === 'VALIDATION') return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
  try {
    const updated = await clientsService.updateClient(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Cliente no encontrado' });
    auditLog(req.adminId, 'client.update', 'client', String(id), { fields: Object.keys(req.body || {}) }, req).catch(() => {});
    return res.json(updated);
  } catch (error) {
    if (error.code === 'VALIDATION') return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:id/pairing/regenerate', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
  try {
    const updated = await clientsService.regeneratePairingToken(id);
    if (!updated) return res.status(404).json({ error: 'Cliente no encontrado' });
    auditLog(req.adminId, 'client.pairing_regenerate', 'client', String(id), {}, req).catch(() => {});
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

  try {
    // Antes de borrar: tirar las sesiones del cliente (memoria + disco) para no dejar basura.
    // La cascada DB se encarga de los rows de wa_sessions.
    const dropped = await sessionsManager.dropSessionsForClient(id);

    const ok = await clientsService.deleteClient(id);
    if (!ok) return res.status(404).json({ error: 'Cliente no encontrado' });

    auditLog(req.adminId, 'client.delete', 'client', String(id), { sessionsDropped: dropped }, req).catch(() => {});
    return res.json({ ok: true, sessionsDropped: dropped });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Conveniencia: listar sesiones de un cliente. La gestión de sesiones sigue
// viviendo en /api/sessions (con clientId en el body al crear), pero esta
// ruta facilita la vista por cliente al frontend.
router.get('/:id/sessions', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
  try {
    const client = await clientsService.getClient(id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    const sessions = await sessionsManager.listSessionsByClient(id);
    return res.json(sessions);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
