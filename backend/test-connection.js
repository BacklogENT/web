require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function testConnection() {
  try {
    console.log('Intentando conectar a MySQL...');
    const sslSetting = (process.env.DB_SSL || 'false').toLowerCase();
    const sslOptions =
      sslSetting === 'required' ? { rejectUnauthorized: false } :
      sslSetting === 'true' ? true :
      false;

    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'db74241.public.databaseasp.net',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'db74241',
      password: process.env.DB_PASSWORD || 'j!8A#Pg7a4Q?',
      database: process.env.DB_NAME || 'db74241',
      ssl: sslOptions
    });
    
    console.log('✅ Conexión exitosa!');
    
    // Verificar si la base de datos existe
    const [rows] = await connection.execute('SELECT DATABASE() as db');
    console.log('Base de datos actual:', rows[0].db);
    
    // Verificar si las tablas existen
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('Tablas existentes:', tables.map(t => Object.values(t)[0]));
    
    await connection.end();
    console.log('✅ Prueba completada exitosamente!');
    
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
    console.error('Código de error:', error.code);
    console.error('Número de error:', error.errno);
    if (error.sql) {
      console.error('SQL:', error.sql);
    }
  }
}

testConnection();