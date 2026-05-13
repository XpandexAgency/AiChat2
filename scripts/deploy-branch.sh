#!/usr/bin/env bash
set -euo pipefail

PUSH=false
if [[ "${1:-}" == "--push" ]]; then
  PUSH=true
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
FRONTEND_DIR="$ROOT_DIR/frontend"
DEPLOY_DIR="$ROOT_DIR/deploy"
WORKTREE_DIR="/private/tmp/$(basename "$ROOT_DIR")-deploy-worktree"
DEPLOY_BRANCH="deploy"
BASE_BRANCH="main"

echo "==> Building frontend into $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

(
  cd "$FRONTEND_DIR"
  # Angular build crashes with current local Node; use stable Node for build.
  npx -y node@20.19.0 ./node_modules/@angular/cli/bin/ng build --output-path ../deploy
)

echo "==> Preparing deploy worktree at $WORKTREE_DIR"
if git -C "$ROOT_DIR" worktree list | grep -q "$WORKTREE_DIR"; then
  git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR"
fi

if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/heads/$DEPLOY_BRANCH"; then
  git -C "$ROOT_DIR" worktree add --force "$WORKTREE_DIR" "$DEPLOY_BRANCH"
else
  git -C "$ROOT_DIR" worktree add --force -b "$DEPLOY_BRANCH" "$WORKTREE_DIR" "$BASE_BRANCH"
fi

echo "==> Syncing deploy folder into deploy branch"
find "$WORKTREE_DIR" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
mkdir -p "$WORKTREE_DIR/deploy"
rsync -a --delete "$DEPLOY_DIR/" "$WORKTREE_DIR/deploy/"

# Copiar backend src
mkdir -p "$WORKTREE_DIR/src"
cp -r "$ROOT_DIR/backend/src/"* "$WORKTREE_DIR/src/"

# Copiar README desde raíz
cp "$ROOT_DIR/README.md" "$WORKTREE_DIR/README_PROJECT.md"
cp "$ROOT_DIR/deploy/README_HOSTINGER.md" "$WORKTREE_DIR/README.md"

cat > "$WORKTREE_DIR/package.json" <<'JSON'
{
  "name": "chatbot-deploy-runtime",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "axios": "^1.16.0",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "qrcode": "^1.5.4",
    "socket.io": "^4.8.3",
    "whatsapp-web.js": "^1.34.7"
  }
}
JSON

cat > "$WORKTREE_DIR/server.js" <<'JS'
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

dotenv.config();

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
app.use(express.static(staticPath));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('sessions:init', Array.from(sessions.values()).map(serializeSession));
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
JS

(
  cd "$WORKTREE_DIR"
  git add -A
  if git diff --cached --quiet; then
    echo "==> No changes to commit on deploy branch"
  else
    git commit -m "Deploy build $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "==> New deploy commit created"
  fi

  if $PUSH; then
    git push -u origin "$DEPLOY_BRANCH"
    echo "==> Deploy branch pushed to origin/$DEPLOY_BRANCH"
  fi
)

echo "==> Done"
echo "    build output: $DEPLOY_DIR"
echo "    branch sync:  $DEPLOY_BRANCH"
