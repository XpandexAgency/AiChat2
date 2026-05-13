const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const QRCode = require('qrcode');
const pino = require('pino');
// Baileys 6.7+ es ESM-only, requiere dynamic import desde un módulo CJS
const baileysPromise = import('@whiskeysockets/baileys');
const { Server } = require('socket.io');

console.log('Iniciando app Node...');

// dotenv: try next to the script first, then one level up (compatible con dev local y deploy)
let envPath = path.resolve(__dirname, '.env');
let dotenvResult = dotenv.config({ path: envPath });
if (dotenvResult.error) {
  const fallback = path.resolve(__dirname, '..', '.env');
  const retry = dotenv.config({ path: fallback });
  if (!retry.error) {
    dotenvResult = retry;
    envPath = fallback;
  }
}
console.log('dotenv:', dotenvResult.error ? `ERROR ${dotenvResult.error.message}` : 'OK');
console.log('dotenv path:', envPath);
console.log('process.cwd():', process.cwd());
console.log('__dirname:', __dirname);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
});

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_WEBHOOK_INCOMING_URL = process.env.WEBHOOK_INCOMING_URL || '';
const DEFAULT_WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const AUTH_DATA_PATH = process.env.AUTH_DATA_PATH
  ? path.resolve(process.env.AUTH_DATA_PATH)
  : path.resolve(__dirname, '.baileys_auth');
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:4200,http://127.0.0.1:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

console.log(`Config: PORT=${PORT} CORS_ORIGINS=${CORS_ORIGINS.join(',')} AUTH=${AUTH_DATA_PATH}`);

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

const baileysLogger = pino({ level: 'silent' });

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

// Acepta número internacional o JID (incluido el legacy "@c.us"); devuelve JID Baileys
function normalizeJid(input) {
  if (input === null || input === undefined) return null;
  const str = String(input).trim();
  if (!str) return null;
  if (str.includes('@')) {
    if (str.endsWith('@c.us')) return str.replace('@c.us', '@s.whatsapp.net');
    return str;
  }
  const digits = str.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

function isAuthorizedWebhook(req) {
  if (!webhookConfig.secret) return true;
  return req.header('x-webhook-secret') === webhookConfig.secret;
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

async function forwardIncomingToWebhook(payload, session) {
  if (!webhookConfig.incomingUrl) return;

  const headers = {};
  if (webhookConfig.secret) headers['x-webhook-secret'] = webhookConfig.secret;

  const response = await axios.post(webhookConfig.incomingUrl, payload, { headers, timeout: 15000 });

  // Si n8n responde con { to, text } → enviar respuesta automática por la misma sesión
  if (response?.data?.to && response?.data?.text && session?.sock) {
    const jid = normalizeJid(response.data.to);
    if (jid) {
      try {
        const sent = await session.sock.sendMessage(jid, { text: String(response.data.text) });
        io.emit('message:outgoing', {
          type: 'outgoing_message',
          source: 'webhook-response',
          sessionId: session.sessionId,
          timestamp: new Date().toISOString(),
          message: { id: sent?.key?.id || null, to: jid, body: String(response.data.text) },
        });
      } catch (sendErr) {
        console.error('Error enviando respuesta de webhook:', sendErr.message);
      }
    }
  }
}

function extractText(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.buttonsResponseMessage?.selectedDisplayText) {
    return message.buttonsResponseMessage.selectedDisplayText;
  }
  if (message.listResponseMessage?.title) return message.listResponseMessage.title;
  return '';
}

function hasMedia(message) {
  if (!message) return false;
  return Boolean(
    message.imageMessage
      || message.videoMessage
      || message.documentMessage
      || message.audioMessage
      || message.stickerMessage,
  );
}

function messageType(message) {
  if (!message) return 'unknown';
  return Object.keys(message)[0] || 'unknown';
}

async function connectSocket(session) {
  const baileys = await baileysPromise;
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;

  const authDir = path.join(AUTH_DATA_PATH, `session-${session.sessionId}`);
  await fs.mkdir(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    // Si no podemos consultar la versión (sin internet, etc.) usamos la default de baileys
  }

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Chatbot', 'Chrome', '120'],
    logger: baileysLogger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  session.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr);
        updateSession(session.sessionId, {
          status: 'waiting_qr_scan',
          qrDataUrl,
          lastError: null,
        });
      } catch (error) {
        updateSession(session.sessionId, {
          status: 'error',
          lastError: `No se pudo generar QR: ${error.message}`,
        });
      }
    }

    if (connection === 'open') {
      const rawId = sock.user?.id || '';
      const connectedNumber = rawId.split(':')[0].split('@')[0] || null;
      updateSession(session.sessionId, {
        status: 'ready',
        qrDataUrl: null,
        connectedNumber,
        lastError: null,
      });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reasonName = Object.entries(DisconnectReason).find(([, v]) => v === statusCode)?.[0]
        || `status ${statusCode ?? 'desconocido'}`;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const current = sessions.get(session.sessionId);

      if (loggedOut) {
        updateSession(session.sessionId, {
          status: 'auth_failure',
          connectedNumber: null,
          qrDataUrl: null,
          lastError: `Sesión cerrada en WhatsApp (${reasonName}). Vuelve a escanear el QR.`,
        });
        try { await fs.rm(authDir, { recursive: true, force: true }); } catch { /* ignore */ }
        session.sock = null;
      } else if (current && current.status !== 'stopped') {
        updateSession(session.sessionId, {
          status: 'disconnected',
          connectedNumber: null,
          lastError: `Desconectado: ${reasonName}. Reconectando...`,
        });
        setTimeout(() => {
          connectSocket(session).catch((err) => {
            updateSession(session.sessionId, {
              status: 'error',
              lastError: `Fallo al reconectar: ${err.message}`,
            });
          });
        }, 2000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key?.fromMe) continue;

      const payload = {
        type: 'incoming_message',
        source: 'whatsapp-web',
        sessionId: session.sessionId,
        mode: session.mode,
        timestamp: new Date().toISOString(),
        message: {
          id: msg.key.id || null,
          from: msg.key.remoteJid,
          body: extractText(msg.message),
          type: messageType(msg.message),
          hasMedia: hasMedia(msg.message),
        },
      };

      io.emit('message:incoming', payload);

      try {
        await forwardIncomingToWebhook(payload, session);
        updateSession(session.sessionId, { lastError: null });
      } catch (error) {
        updateSession(session.sessionId, {
          lastError: `Error enviando webhook entrante: ${formatWebhookError(error)}`,
        });
      }
    }
  });
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
    sock: null,
  };

  sessions.set(sessionId, session);
  emitSessionUpdate(sessionId);

  try {
    await connectSocket(session);
  } catch (error) {
    updateSession(sessionId, { status: 'error', lastError: error.message });
  }

  return session;
}

async function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  try {
    if (session.sock) {
      session.sock.end(undefined); // cierra WebSocket sin hacer logout
    }
  } catch (error) {
    updateSession(sessionId, { lastError: `Error al cerrar sesión: ${error.message}` });
  }

  updateSession(sessionId, {
    status: 'stopped',
    qrDataUrl: null,
    connectedNumber: null,
    sock: null,
  });

  return true;
}

async function deleteSession(sessionId) {
  const session = sessions.get(sessionId);

  if (session?.sock) {
    try { await session.sock.logout(); } catch { /* ignore */ }
    try { session.sock.end(undefined); } catch { /* ignore */ }
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
  if (!session || !session.sock) {
    throw new Error(`La sesión ${sessionId} no existe o no está inicializada.`);
  }

  if (session.status !== 'ready') {
    throw new Error(`La sesión ${sessionId} no está lista. Estado: ${session.status}`);
  }

  const jid = normalizeJid(to);
  if (!jid) {
    throw new Error('Destino inválido. Usa número internacional, por ejemplo: 34600111222');
  }

  const sent = await session.sock.sendMessage(jid, { text: String(text) });

  const payload = {
    type: 'outgoing_message',
    source: 'chatbot',
    sessionId,
    timestamp: new Date().toISOString(),
    message: {
      id: sent?.key?.id || null,
      to: jid,
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
  res.json([...sessions.values()].map(serializeSession));
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  return res.json(serializeSession(session));
});

app.post('/api/sessions/start', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  const mode = req.body?.mode === 'business' ? 'business' : 'normal';

  if (!sessionId) return res.status(400).json({ error: 'sessionId es requerido' });

  try {
    const session = await startSession(sessionId, mode);
    return res.status(201).json(serializeSession(session));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/stop', async (req, res) => {
  const ok = await stopSession(req.params.sessionId);
  if (!ok) return res.status(404).json({ error: 'Sesión no encontrada' });
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
  if (!isAuthorizedWebhook(req)) return res.status(401).json({ error: 'No autorizado' });

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

// Static frontend: solo si está montado (en deploy). En dev local no aplica.
const staticPath = path.resolve(process.cwd(), 'deploy', 'browser');
if (fsSync.existsSync(staticPath)) {
  console.log(`Sirviendo archivos estáticos desde: ${staticPath}`);
  app.use(express.static(staticPath));
  // SPA fallback. Express 5 requiere wildcard nombrado (path-to-regexp v8).
  app.get('/*splat', (_req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
} else {
  console.log(`No se sirve frontend estático (no existe ${staticPath})`);
}

io.on('connection', (socket) => {
  const list = [...sessions.values()].map(serializeSession);
  socket.emit('sessions:init', list);
});

server.on('error', (error) => {
  console.error('Error en el servidor HTTP:', error);
});

process.on('exit', (code) => console.error(`Proceso saliendo con código ${code}`));
process.on('SIGINT', () => { console.error('Recibido SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { console.error('Recibido SIGTERM'); process.exit(0); });
process.on('uncaughtException', (error) => console.error('uncaughtException:', error));
process.on('unhandledRejection', (reason) => console.error('unhandledRejection:', reason));

// Sin host explícito: deja que Node escuche en todas las interfaces y deja a Passenger
// gestionar el socket si está en uso (Hostinger). Evita conflictos con '0.0.0.0' literal.
server.listen(PORT, () => {
  console.log(`Backend listo en puerto ${PORT}`);
});

module.exports = app;
