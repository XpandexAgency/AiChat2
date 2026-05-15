const bcrypt = require('bcryptjs');
const pool = require('./pool');

const BCRYPT_ROUNDS = 12;

async function bootstrapFirstAdmin() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!email || !password) return; // sin bootstrap configurado

  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM admins');
  if (count > 0) return; // ya hay al menos un admin → no crear duplicado

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    await pool.execute(
      'INSERT INTO admins (email, password_hash) VALUES (?, ?)',
      [email, hash],
    );
    console.log(`Admin bootstrap creado: ${email}`);
    console.log('⚠️  Cambia la contraseña al primer login y elimina ADMIN_BOOTSTRAP_* del .env.');
  } catch (error) {
    // Race condition: otro arranque concurrente o email duplicado
    if (error.code === 'ER_DUP_ENTRY') return;
    throw error;
  }
}

module.exports = { bootstrapFirstAdmin, BCRYPT_ROUNDS };
