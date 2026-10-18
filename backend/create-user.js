'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./db');

function readSecret(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Ejecute este comando en una terminal interactiva compatible con entrada oculta.');
  }
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = chunk => {
      const key = chunk.toString('utf8');
      if (key === '\u0003') {
        cleanup();
        reject(new Error('Operación cancelada.'));
      } else if (key === '\r' || key === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(value);
      } else if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
      } else if (!/[\u0000-\u001f\u007f]/.test(key)) {
        value += key;
      }
    };
    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw || false);
    }
    stdin.on('data', onData);
  });
}

async function main() {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const name = (await terminal.question('Nombre: ')).trim();
    const email = (await terminal.question('Correo: ')).trim().toLowerCase();
    const profile = (await terminal.question('Perfil (administrador/edicion/consulta): ')).trim().toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingrese un nombre y correo válidos.');
    if (!['administrador', 'edicion', 'consulta'].includes(profile)) throw new Error('Perfil no válido.');
    if (profile === 'administrador' && !(process.env.ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).includes(email)) {
      throw new Error('Agregue el correo a ADMIN_EMAILS en backend/.env y reinicie antes de crear una cuenta administradora.');
    }
    terminal.close();
    const password = await readSecret('Contraseña nueva (mínimo 12 caracteres): ');
    const confirm = await readSecret('Repita la contraseña: ');
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || password !== confirm) {
      throw new Error('La contraseña debe tener entre 12 y 72 bytes UTF-8 y coincidir con la confirmación.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.execute(
      `INSERT INTO users (id, name, email, password_hash, profile, active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), profile = VALUES(profile), active = 1`,
      [crypto.randomUUID(), name, email, passwordHash, profile]
    );
    console.log(`Cuenta ${profile} creada/actualizada para ${email}.`);
  } finally {
    terminal.close();
    await pool.end();
  }
}

main().catch(error => {
  console.error('No se pudo crear la cuenta:', error.message);
  process.exitCode = 1;
});
