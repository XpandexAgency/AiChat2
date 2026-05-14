const express = require('express');
const auditService = require('./service');
const { requireAdmin } = require('../../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const filters = {
      adminId: req.query.adminId ? Number(req.query.adminId) : null,
      action: req.query.action || null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
    };

    const logs = await auditService.getAuditLogs(filters);
    return res.json(logs);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
