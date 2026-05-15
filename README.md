# WhatsApp QR Hub (Angular + Node)

Web app para:

- Conectar sesiones de WhatsApp por QR (cuentas normales y Business app en modo multi-dispositivo).
- Ver estado y QR en tiempo real desde Angular.
- Reenviar mensajes entrantes a un webhook de chatbot.
- Recibir órdenes de envío desde webhook y mandar mensajes por WhatsApp.

## Arquitectura

- `frontend/`: Angular 19 (panel de control)
- `backend/`: Express + `whatsapp-web.js` + Socket.IO

## Requisitos

- Node.js `>= 18` (en esta máquina se usó `20.13.1`)
- Tener Google Chrome/Chromium disponible para `whatsapp-web.js`

## Configuración backend

1. Copia variables de entorno:

```bash
cd backend
cp .env.example .env
```

2. Ajusta `.env`:

- `CORS_ORIGIN`: URL del frontend (por defecto `http://localhost:4200`)
- `WEBHOOK_INCOMING_URL`: endpoint de tu bot para mensajes entrantes
- `WEBHOOK_SECRET`: secreto opcional para validar webhooks
- `HEADLESS`: `true` o `false`

## Arranque

Terminal 1 (backend):

```bash
npm run dev:backend
```

Terminal 2 (frontend Angular):

```bash
npm run dev:frontend
```

Frontend: `http://localhost:4200`
Backend: `http://localhost:3000`

## Endpoints principales

- `GET /api/health`
- `GET /api/webhook-config`
- `PUT /api/webhook-config`
  - body: `{ "incomingUrl": "https://tu-n8n/webhook/...", "secret": "opcional" }`
- `POST /api/webhook-config/test`
- `GET /api/sessions`
- `POST /api/sessions/start`
  - body: `{ "sessionId": "bot-main", "mode": "normal" | "business" }`
- `POST /api/sessions/:sessionId/stop`
- `POST /api/messages/send`
  - body: `{ "sessionId": "bot-main", "to": "34600111222", "text": "hola" }`
- `POST /api/webhooks/chatbot`
  - body: `{ "sessionId": "bot-main", "to": "34600111222", "text": "respuesta del bot" }`
  - header opcional: `x-webhook-secret`

## Webhook entrante (hacia tu bot)

Cuando llega un mensaje en WhatsApp, el backend hace `POST` a `WEBHOOK_INCOMING_URL` con payload similar:

```json
{
  "type": "incoming_message",
  "source": "whatsapp-web",
  "sessionId": "bot-main",
  "mode": "normal",
  "timestamp": "2026-05-05T00:00:00.000Z",
  "message": {
    "id": "...",
    "from": "34600111222@c.us",
    "body": "hola",
    "type": "chat",
    "hasMedia": false
  }
}
```

## Nota importante

Este proyecto usa `whatsapp-web.js` (automatización de WhatsApp Web), no la API oficial de WhatsApp Business Platform (Cloud API). Para producción empresarial estricta, revisa la opción oficial de Meta.

## Flujo Git recomendado

Ramas:

- `testing`: desarrollo diario
- `main`: estable
- `deploy`: artefactos compilados para hosting

Comandos rápidos:

```bash
# ver estado actual
npm run flow:status

# crear rama de feature desde testing
npm run feature:start -- webhook-form-improvements

# integrar feature actual en testing
npm run feature:finish

# promocionar testing a main
npm run main:promote

# publicar a rama deploy (VPS aichat.xpandex.es)
npm run publish:deploy
```

Flujo habitual:

1. Crear `feature/*`, trabajar, commit y push de la feature.
2. Integrar feature a `testing`.
3. Cuando testing está OK, promover a `main`.
4. Publicar estáticos con `publish:deploy`.

# AiChat2
