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
  }
}
JSON

cat > "$WORKTREE_DIR/server.js" <<'JS'
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'deploy', 'browser');
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const safePath = decodeURIComponent((req.url || '/').split('?')[0]);
  const requested = safePath === '/' ? '/index.html' : safePath;
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(res, filePath);
      return;
    }

    // SPA fallback
    sendFile(res, path.join(root, 'index.html'));
  });
});

server.listen(port, () => {
  console.log(`Deploy runtime listening on http://localhost:${port}`);
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
