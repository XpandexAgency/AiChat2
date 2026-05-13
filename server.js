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

console.log('Iniciando app Node...');

dotenv.config();

console.log('dotenv cargado');

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
const AUTH_DATA_PATH = process.env.AUTH_DATA_PATH || path.resolve(__dirname, '.wwebjs_auth');
const HEADLESS = process.env.HEADLESS !== 'false';
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:4200,http://127.0.0.1:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

console.log(`Configuración: PORT=${PORT}, HEADLESS=${HEADLESS}, CORS_ORIGINS=${CORS_ORIGINS.join(',')}`);

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

console.log('Express configurado');

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

  try {
    const response = await axios.post(webhookConfig.incomingUrl, payload, { headers, timeout: 15000 });
    // Si n8n responde con un mensaje de vuelta (webhook response)
    if (response.data && response.data.to && response.data.text) {
      const { to, text } = response.data;
      // Enviar el mensaje de vuelta por WhatsApp
      const sessionId = 'bot-main'; // Asumir sesión principal, ajustar si necesario
      const session = sessions.get(sessionId);
      if (session && session.client) {
        try {
          const chatId = normalizeChatId(to);
          if (chatId) {
            await session.client.sendMessage(chatId, text);
            const outgoingPayload = {
              sessionId,
              message: { id: 'webhook-response', to: chatId, body: text },
              timestamp: new Date().toISOString(),
            };
            io.emit('message:outgoing', outgoingPayload);
          }
        } catch (sendError) {
          console.error('Error enviando mensaje desde webhook response:', sendError.message);
        }
      }
    }
  } catch (error) {
    console.error('Error en webhook entrante:', formatWebhookError(error));
  }
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

    const sessionId = 'bot-main'; // Asumir sesión principal, ajustar si necesario
    const payload = {
      type: 'incoming_message',
      source: 'whatsapp-web',
      sessionId,
      mode: 'normal',
      timestamp: new Date().toISOString(),
      message: {
        id: message.id.id,
        from: message.from,
        body: message.body,
        type: message.type,
        hasMedia: message.hasMedia,
      },
    };

    io.emit('message:incoming', payload);
    await forwardIncomingToWebhook(payload);
  });

  try {
    await client.initialize();
    updateSession(sessionId, { status: 'initialized' });
  } catch (error) {
    updateSession(sessionId, {
      status: 'error',
      lastError: `Error al inicializar: ${error.message}`,
    });
  }

  return session;
}

async function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || !session.client) return;

  try {
    await session.client.destroy();
    updateSession(sessionId, { status: 'stopped', qrDataUrl: null, connectedNumber: null });
  } catch (error) {
    updateSession(sessionId, { status: 'error', lastError: `Error al detener: ${error.message}` });
  }
}

async function deleteSession(sessionId) {
  await stopSession(sessionId);
  sessions.delete(sessionId);
  io.emit('session:removed', { sessionId });
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/webhook-config', (req, res) => {
  res.json(serializeWebhookConfig());
});

app.put('/api/webhook-config', (req, res) => {
  const { incomingUrl, secret } = req.body;
  if (typeof incomingUrl === 'string') webhookConfig.incomingUrl = incomingUrl;
  if (typeof secret === 'string') webhookConfig.secret = secret;
  res.json(serializeWebhookConfig());
});

app.post('/api/webhook-config/test', async (req, res) => {
  try {
    await forwardIncomingToWebhook({ type: 'test', timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: formatWebhookError(error) });
  }
});

app.get('/api/sessions', (req, res) => {
  const list = Array.from(sessions.values()).map(serializeSession);
  res.json(list);
});

app.post('/api/sessions/start', async (req, res) => {
  const { sessionId, mode } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId requerido' });

  try {
    const session = await startSession(sessionId, mode);
    res.json(serializeSession(session));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/stop', async (req, res) => {
  const { sessionId } = req.params;
  await stopSession(sessionId);
  res.json({ success: true });
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  await deleteSession(sessionId);
  res.json({ success: true });
});

app.post('/api/messages/send', async (req, res) => {
  const { sessionId, to, text } = req.body;
  if (!sessionId || !to || !text) return res.status(400).json({ error: 'sessionId, to y text requeridos' });

  const session = sessions.get(sessionId);
  if (!session || !session.client) return res.status(404).json({ error: 'Sesión no encontrada o no lista' });

  try {
    const chatId = normalizeChatId(to);
    if (!chatId) return res.status(400).json({ error: 'Número de teléfono inválido' });

    const message = await session.client.sendMessage(chatId, text);
    const payload = {
      sessionId,
      message: { id: message.id.id, to: chatId, body: text },
      timestamp: new Date().toISOString(),
    };
    io.emit('message:outgoing', payload);
    res.json({ success: true, messageId: message.id.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webhooks/chatbot', (req, res) => {
  if (!isAuthorizedWebhook(req)) return res.status(401).json({ error: 'No autorizado' });

  const { sessionId, to, text } = req.body;
  if (!sessionId || !to || !text) return res.status(400).json({ error: 'sessionId, to y text requeridos' });

  const session = sessions.get(sessionId);
  if (!session || !session.client) return res.status(404).json({ error: 'Sesión no encontrada o no lista' });

  session.client.sendMessage(normalizeChatId(to), text)
    .then((message) => {
      const payload = {
        sessionId,
        message: { id: message.id.id, to: normalizeChatId(to), body: text },
        timestamp: new Date().toISOString(),
      };
      io.emit('message:outgoing', payload);
      res.json({ success: true, messageId: message.id.id });
    })
    .catch((error) => res.status(500).json({ error: error.message }));
});

// Servir archivos estáticos del frontend
const staticPath = path.join(__dirname, 'deploy', 'browser');
console.log(`Sirviendo archivos estáticos desde: ${staticPath}`);
app.use(express.static(staticPath));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('sessions:init', Array.from(sessions.values()).map(serializeSession));
});

console.log(`Intentando escuchar en puerto ${PORT}...`);

server.on('error', (error) => {
  console.error('Error en el servidor HTTP:', error);
});

try {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
  });
} catch (error) {
  console.error('Error al iniciar servidor:', error.message);
}
