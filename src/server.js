const path = require('path');
const fs = require('fs/promises');
const http = require('http');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { Server } = require('socket.io');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
});

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_WEBHOOK_INCOMING_URL = process.env.WEBHOOK_INCOMING_URL || '';
const DEFAULT_WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const AUTH_DATA_PATH = process.env.AUTH_DATA_PATH || path.resolve(__dirname, '..', '.wwebjs_auth');
const HEADLESS = process.env.HEADLESS !== 'false';
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:4200,http://127.0.0.1:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

const sessions = new Map();
const webhookConfig = {
  incomingUrl: DEFAULT_WEBHOOK_INCOMING_URL,
  secret: DEFAULT_WEBHOOK_SECRET,
};

function serializeWebhookConfig() {
  return {
    incomingUrl: webhookConfig.incomingUrl,
    secretConfigured: Boolean(webhookConfig.secret),
  };
}

function serializeSession(session) {
  return {
    sessionId: session.sessionId,
    mode: session.mode,
    status: session.status,
    qrDataUrl: session.qrDataUrl,
    lastError: session.lastError,
    connectedNumber: session.connectedNumber,
    updatedAt: session.updatedAt,
  };
}

function emitSessionUpdate(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  io.emit('session:update', serializeSession(session));
}

function updateSession(sessionId, patch) {
  const session = sessions.get(sessionId);
  if (!session) return;

  Object.assign(session, patch, { updatedAt: new Date().toISOString() });
  emitSessionUpdate(sessionId);
}

function normalizeChatId(phoneOrChatId) {
  const clean = String(phoneOrChatId || '').replace(/[^\d]/g, '');
  if (!clean) return null;
  return `${clean}@c.us`;
}

function isAuthorizedWebhook(req) {
  if (!webhookConfig.secret) return true;
  return req.header('x-webhook-secret') === webhookConfig.secret;
}

async function forwardIncomingToWebhook(payload) {
  if (!webhookConfig.incomingUrl) return;

  const headers = {};
  if (webhookConfig.secret) headers['x-webhook-secret'] = webhookConfig.secret;

  await axios.post(webhookConfig.incomingUrl, payload, { headers, timeout: 15000 });
}

function formatWebhookError(error) {
  const code = error?.code ? String(error.code) : '';
  const message = error?.message ? String(error.message) : '';
  const status = error?.response?.status ? String(error.response.status) : '';

  let detail = '';
  if (error?.response?.data) {
    if (typeof error.response.data === 'string') {
      detail = error.response.data.slice(0, 180);
    } else {
      try {
        detail = JSON.stringify(error.response.data).slice(0, 180);
      } catch {
        detail = '';
      }
    }
  }

  const base = [code, message].filter(Boolean).join(' - ') || 'sin detalle';
  const statusPart = status ? ` (HTTP ${status})` : '';
  const detailPart = detail ? ` | body: ${detail}` : '';
  return `${base}${statusPart}${detailPart}`;
}

async function startSession(sessionId, mode = 'normal') {
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (existing.status === 'stopped') {
      sessions.delete(sessionId);
    } else {
      return existing;
    }
  }

  const session = {
    sessionId,
    mode,
    status: 'starting',
    qrDataUrl: null,
    lastError: null,
    connectedNumber: null,
    updatedAt: new Date().toISOString(),
    client: null,
  };

  sessions.set(sessionId, session);
  emitSessionUpdate(sessionId);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: AUTH_DATA_PATH,
    }),
    puppeteer: {
      headless: HEADLESS,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  session.client = client;

  client.on('qr', async (qr) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(qr);
      updateSession(sessionId, { status: 'waiting_qr_scan', qrDataUrl, lastError: null });
    } catch (error) {
      updateSession(sessionId, {
        status: 'error',
        lastError: `No se pudo generar QR: ${error.message}`,
      });
    }
  });

  client.on('ready', () => {
    const connectedNumber = client.info?.wid?.user || null;
    updateSession(sessionId, {
      status: 'ready',
      qrDataUrl: null,
      connectedNumber,
      lastError: null,
    });
  });

  client.on('authenticated', () => {
    updateSession(sessionId, { status: 'authenticated', lastError: null });
  });

  client.on('auth_failure', (msg) => {
    updateSession(sessionId, { status: 'auth_failure', lastError: msg || 'Fallo de autenticación.' });
  });

  client.on('disconnected', (reason) => {
    updateSession(sessionId, {
      status: 'disconnected',
      connectedNumber: null,
      lastError: reason ? `Desconectado: ${reason}` : null,
    });
  });

  client.on('message', async (message) => {
    if (message.fromMe) return;

    const payload = {
      type: 'incoming_message',
      source: 'whatsapp-web',
      sessionId,
      mode,
      timestamp: new Date().toISOString(),
      message: {
        id: message.id?._serialized || null,
        from: message.from,
        body: message.body || '',
        type: message.type,
        hasMedia: message.hasMedia,
      },
    };

    io.emit('message:incoming', payload);

    try {
      await forwardIncomingToWebhook(payload);
      updateSession(sessionId, { lastError: null });
    } catch (error) {
      updateSession(sessionId, {
        lastError: `Error enviando webhook entrante: ${formatWebhookError(error)}`,
      });
    }
  });

  client
    .initialize()
    .catch((error) => updateSession(sessionId, { status: 'error', lastError: error.message }));

  return session;
}

async function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  try {
    if (session.client) {
      await session.client.destroy();
    }
  } catch (error) {
    updateSession(sessionId, { lastError: `Error al cerrar sesión: ${error.message}` });
  }

  updateSession(sessionId, {
    status: 'stopped',
    qrDataUrl: null,
    connectedNumber: null,
    client: null,
  });

  return true;
}

async function deleteSession(sessionId) {
  const session = sessions.get(sessionId);

  if (session?.client) {
    try {
      await session.client.destroy();
    } catch {
      // ignore — vamos a borrar igualmente
    }
  }

  sessions.delete(sessionId);

  const authDir = path.join(AUTH_DATA_PATH, `session-${sessionId}`);
  try {
    await fs.rm(authDir, { recursive: true, force: true });
  } catch (error) {
    io.emit('session:removed', { sessionId, warning: `No se pudo borrar ${authDir}: ${error.message}` });
    return { ok: true, warning: error.message };
  }

  io.emit('session:removed', { sessionId });
  return { ok: true };
}

async function sendMessage(sessionId, to, text) {
  const session = sessions.get(sessionId);
  if (!session || !session.client) {
    throw new Error(`La sesión ${sessionId} no existe o no está inicializada.`);
  }

  if (session.status !== 'ready') {
    throw new Error(`La sesión ${sessionId} no está lista. Estado: ${session.status}`);
  }

  const chatId = to.includes('@') ? to : normalizeChatId(to);
  if (!chatId) {
    throw new Error('Destino inválido. Usa número internacional, por ejemplo: 34600111222');
  }

  const sent = await session.client.sendMessage(chatId, text);

  const payload = {
    type: 'outgoing_message',
    source: 'chatbot',
    sessionId,
    timestamp: new Date().toISOString(),
    message: {
      id: sent.id?._serialized || null,
      to: chatId,
      body: text,
    },
  };

  io.emit('message:outgoing', payload);

  return payload;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/api/webhook-config', (_req, res) => {
  res.json(serializeWebhookConfig());
});

app.put('/api/webhook-config', (req, res) => {
  const incomingUrl = String(req.body?.incomingUrl || '').trim();
  const secret = String(req.body?.secret || '').trim();

  if (incomingUrl) {
    try {
      const parsed = new URL(incomingUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'El webhook debe empezar por http:// o https://' });
      }
    } catch {
      return res.status(400).json({ error: 'URL de webhook inválida' });
    }
  }

  webhookConfig.incomingUrl = incomingUrl;
  webhookConfig.secret = secret;
  return res.json({ ok: true, config: serializeWebhookConfig() });
});

app.post('/api/webhook-config/test', async (req, res) => {
  const incomingUrl = String(req.body?.incomingUrl || '').trim() || webhookConfig.incomingUrl;
  const secret = String(req.body?.secret || '').trim() || webhookConfig.secret;

  if (!incomingUrl) {
    return res.status(400).json({ error: 'Configura primero la URL del webhook' });
  }

  try {
    const parsed = new URL(incomingUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'El webhook debe empezar por http:// o https://' });
    }
  } catch {
    return res.status(400).json({ error: 'URL de webhook inválida' });
  }

  const headers = {};
  if (secret) headers['x-webhook-secret'] = secret;

  const payload = {
    type: 'webhook_test',
    source: 'whatsapp-web',
    timestamp: new Date().toISOString(),
    message: 'Prueba manual desde panel',
  };

  try {
    const response = await axios.post(incomingUrl, payload, { headers, timeout: 15000 });
    return res.json({ ok: true, status: response.status });
  } catch (error) {
    return res.status(400).json({ error: formatWebhookError(error) });
  }
});

app.get('/api/sessions', (_req, res) => {
  const data = [...sessions.values()].map(serializeSession);
  res.json(data);
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }

  return res.json(serializeSession(session));
});

app.post('/api/sessions/start', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  const mode = req.body?.mode === 'business' ? 'business' : 'normal';

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId es requerido' });
  }

  try {
    const session = await startSession(sessionId, mode);
    return res.status(201).json(serializeSession(session));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/stop', async (req, res) => {
  const ok = await stopSession(req.params.sessionId);
  if (!ok) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }

  return res.json({ ok: true });
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
  const result = await deleteSession(req.params.sessionId);
  return res.json(result);
});

app.post('/api/messages/send', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  const to = String(req.body?.to || '').trim();
  const text = String(req.body?.text || '').trim();

  if (!sessionId || !to || !text) {
    return res.status(400).json({ error: 'sessionId, to y text son requeridos' });
  }

  try {
    const result = await sendMessage(sessionId, to, text);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/webhooks/chatbot', async (req, res) => {
  if (!isAuthorizedWebhook(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const sessionId = String(req.body?.sessionId || '').trim();
  const to = String(req.body?.to || '').trim();
  const text = String(req.body?.text || '').trim();

  if (!sessionId || !to || !text) {
    return res.status(400).json({ error: 'sessionId, to y text son requeridos' });
  }

  try {
    const result = await sendMessage(sessionId, to, text);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

io.on('connection', (socket) => {
  const list = [...sessions.values()].map(serializeSession);
  socket.emit('sessions:init', list);
});

server.on('error', (error) => {
  console.error('Error en el servidor HTTP:', error);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listo en http://0.0.0.0:${PORT}`);
});
