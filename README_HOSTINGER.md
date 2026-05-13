# Hostinger deployment notes (Node.js)

This repository builds the complete app (frontend + backend) into the `deploy` branch.

## For Hostinger Node.js hosting

1. Clone or pull the `deploy` branch.
2. The root should contain:
   - `server.js` (main server with Express + WhatsApp + static files)
   - `package.json` (with dependencies)
   - `deploy/browser/` (compiled frontend)
   - `src/` (backend source)
3. Run `npm install` to install dependencies.
4. Set environment variables in Hostinger:
   - `PORT` (the port Hostinger assigns)
   - `WEBHOOK_INCOMING_URL` (your n8n webhook URL)
   - `WEBHOOK_SECRET` (optional secret)
   - `HEADLESS=true` (recommended for server)
   - `CORS_ORIGIN` (your frontend URL if needed)
5. Start with `npm start`.

## Important notes

- WhatsApp Web.js requires Chrome/Chromium. Hostinger may need Puppeteer config.
- Sessions are stored in `.wwebjs_auth` (persistent across restarts).
- The app serves both API (`/api`) and frontend static files.
- Socket.IO is available at `/socket.io` for real-time updates.