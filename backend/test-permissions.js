const mysql = require('mysql2/promise');

async function testPermissions() {
  try {
    console.log('Probando permisos del usuario...');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'db74241.public.databaseasp.net',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'db74241',
      password: process.env.DB_PASSWORD || 'j!8A#Pg7a4Q?',
      database: process.env.DB_NAME || 'db74241',
      ssl: false
    });
    
    // Verificar privilegios
    const [privileges] = await connection.execute('SHOW GRANTS FOR CURRENT_USER()');
    console.log('Privilegios actuales:');
    privileges.forEach(grant => console.log('  -', grant.Grant));
    
    // Intentar crear una tabla temporal
    try {
      await connection.execute('CREATE TEMPORARY TABLE test_table (id INT)');
      console.log('✅ Puede crear tablas temporales');
      await connection.execute('DROP TEMPORARY TABLE test_table');
    } catch (error) {
      console.log('❌ No puede crear tablas temporales:', error.message);
    }
    
    // Intentar crear una tabla permanente
    try {
      await connection.execute('CREATE TABLE test_table (id INT)');
      console.log('✅ Puede crear tablas permanentes');
      await connection.execute('DROP TABLE test_table');
    } catch ( error) {
      console.log('❌ No puede crear tablas permanentes:', error.message);
    }
    
    await connection.end();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testPermissions();