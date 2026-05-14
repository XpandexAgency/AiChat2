#!/usr/bin/env node

const bcrypt = require('bcrypt');
const pool = require('../src/db/pool');

async function createAdmin(email, password) {
  const connection = await pool.getConnection();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await connection.execute('INSERT INTO admins (email, password_hash) VALUES (?, ?)', [email, passwordHash]);
    console.log(`Admin created: ${email}`);
  } finally {
    connection.release();
  }
}

const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!email || !password) {
  console.error('Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD env vars');
  process.exit(1);
}

createAdmin(email, password)
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
