'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function migrate() {
  if (!process.env.DB_NAME) throw new Error('Defina DB_NAME en backend/.env y cree previamente esa base de datos en MySQL.');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    ssl: false
  });
  try {
    const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    const statements = schema.split(/;\s*(?:\r?\n|$)/).map(statement => statement.trim()).filter(Boolean);
    console.log('Ejecutando', statements.length, 'sentencias SQL...');
    
    for (let i = 0; i < statements.length; i++) {
      try {
        await connection.query(statements[i]);
        console.log(`✅ Sentencia ${i + 1}/${statements.length} ejecutada correctamente`);
      } catch (error) {
        console.error(`❌ Error en sentencia ${i + 1}/${statements.length}:`, error.message);
        console.error('SQL:', statements[i]);
        throw error;
      }
    }
    
    console.log(`Esquema preparado en la base MySQL "${process.env.DB_NAME}". No se insertaron usuarios ni proyectos.`);
  } finally {
    await connection.end();
  }
}

migrate().catch(error => {
  console.error('No se pudo aplicar schema.sql:', error.message);
  process.exitCode = 1;
});
