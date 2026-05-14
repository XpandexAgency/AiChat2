const axios = require('axios');
const pool = require('../../db/pool');

// Phase 2: la config de webhook vive por cliente en `clients.webhook_*`.
// Nada de estado en memoria.

async function getClientWebhookConfig(clientId) {
  if (!clientId) return null;
  const [rows] = await pool.execute(
    'SELECT webhook_incoming_url, webhook_secret, is_active FROM clients WHERE id = ?',
    [clientId],
  );
  if (rows.length === 0) return null;
  return {
    incomingUrl: rows[0].webhook_incoming_url || '',
    secret: rows[0].webhook_secret || '',
    isActive: Boolean(rows[0].is_active),
  };
}

// Compara el header x-webhook-secret con el secret del cliente cuyo client_id
// llega resuelto. Si el cliente no tiene secret configurado, deniega siempre
// (mejor a fail-open).
function checkClientSecret(req, clientSecret) {
  if (!clientSecret) return false;
  return req.header('x-webhook-secret') === clientSecret;
}

function validateUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

function formatError(error) {
  const code = error?.code ? String(error.code) : '';
  const message = error?.message ? String(error.message) : '';
  const status = error?.response?.status ? String(error.response.status) : '';

  let detail = '';
  if (error?.response?.data) {
    if (typeof error.response.data === 'string') {
      detail = error.response.data.slice(0, 180);
    } else {
      try { detail = JSON.stringify(error.response.data).slice(0, 180); } catch { detail = ''; }
    }
  }

  const base = [code, message].filter(Boolean).join(' - ') || 'sin detalle';
  const statusPart = status ? ` (HTTP ${status})` : '';
  const detailPart = detail ? ` | body: ${detail}` : '';
  return `${base}${statusPart}${detailPart}`;
}

// Forward incoming WhatsApp payload to the URL configured on the client.
// Returns { to, text } if the webhook responded with an auto-reply, else null.
// Throws on network / non-2xx errors.
async function forwardIncoming(clientId, payload) {
  const cfg = await getClientWebhookConfig(clientId);
  if (!cfg || !cfg.incomingUrl) return null;

  const headers = {};
  if (cfg.secret) headers['x-webhook-secret'] = cfg.secret;

  const response = await axios.post(cfg.incomingUrl, payload, {
    headers,
    timeout: 15000,
  });

  if (response?.data?.to && response?.data?.text) {
    return { to: String(response.data.to), text: String(response.data.text) };
  }
  return null;
}

async function testIncoming(url, secret) {
  const headers = {};
  if (secret) headers['x-webhook-secret'] = secret;
  const payload = {
    type: 'webhook_test',
    source: 'whatsapp-web',
    timestamp: new Date().toISOString(),
    message: 'Prueba manual desde panel',
  };
  const response = await axios.post(url, payload, { headers, timeout: 15000 });
  return { status: response.status };
}

module.exports = {
  getClientWebhookConfig,
  checkClientSecret,
  validateUrl,
  formatError,
  forwardIncoming,
  testIncoming,
};
