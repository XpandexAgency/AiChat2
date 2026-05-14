const path = require('path');
const dotenv = require('dotenv');

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

const requiredVars = [
  'PORT',
  'CORS_ORIGIN',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'SESSION_SECRET',
];

const optionalVars = [
  'WEBHOOK_INCOMING_URL',
  'WEBHOOK_SECRET',
  'AUTH_DATA_PATH',
];

// Loguea explícitamente para que Hostinger lo capture en console.log
console.log(`Node version: ${process.version}`);
console.log(`process.cwd(): ${process.cwd()}`);
console.log(`__dirname: ${__dirname}`);

const missing = requiredVars.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error('==========================================');
  console.error('STARTUP FAILED: faltan env vars requeridas');
  console.error('Faltan:', missing.join(', '));
  console.error('Presentes:', requiredVars.filter((v) => process.env[v]).join(', ') || '(ninguna)');
  console.error('==========================================');
  process.exit(1);
}

console.log('Env vars requeridas: OK');

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  CORS_ORIGINS: (process.env.CORS_ORIGIN || 'http://localhost:4200,http://127.0.0.1:4200')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  DB_HOST: process.env.DB_HOST,
  DB_PORT: Number(process.env.DB_PORT),
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,
  SESSION_SECRET: process.env.SESSION_SECRET,
  WEBHOOK_INCOMING_URL: process.env.WEBHOOK_INCOMING_URL || '',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
  AUTH_DATA_PATH: process.env.AUTH_DATA_PATH || path.resolve(__dirname, '..', '.baileys_auth'),
};
