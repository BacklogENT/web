'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mysql = require('mysql2/promise');
const database = process.env.DB_NAME;

if (!database) throw new Error('Defina DB_NAME en backend/.env antes de iniciar el backend.');
if (!Number.isInteger(Number(process.env.DB_PORT || 3306)) ||
    Number(process.env.DB_PORT || 3306) < 1 || Number(process.env.DB_PORT || 3306) > 65535) {
  throw new Error('DB_PORT debe ser un número entre 1 y 65535.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '12345678',
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true
});

async function verifySchema() {
  await pool.query('SELECT 1');
  await pool.query('SELECT id FROM users LIMIT 0');
  await pool.query('SELECT token_hash FROM password_reset_tokens LIMIT 0');
  await pool.query('SELECT id FROM projects LIMIT 0');
  await pool.query('SELECT setting_key FROM app_settings LIMIT 0');
  await pool.query('SELECT id FROM project_events LIMIT 0');
}

module.exports = { pool, verifySchema };
