const mysql = require('mysql2/promise');

async function createSchema() {
  try {
    console.log('Creando esquema manualmente...');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'db74241.public.databaseasp.net',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'db74241',
      password: process.env.DB_PASSWORD || 'j!8A#Pg7a4Q?',
      database: process.env.DB_NAME || 'db74241',
      ssl: false
    });
    
    // Crear tabla users
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id CHAR(36) NOT NULL PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          email VARCHAR(320) NOT NULL UNIQUE,
          password_hash VARCHAR(100) NOT NULL,
          profile ENUM('consulta', 'edicion', 'administrador') NOT NULL DEFAULT 'consulta',
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Tabla users creada');
    } catch (error) {
      console.log('❌ Error al crear tabla users:', error.message);
    }
    
    // Crear tabla password_reset_tokens
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id CHAR(36) NOT NULL PRIMARY KEY,
          user_id CHAR(36) NOT NULL,
          token_hash CHAR(64) NOT NULL UNIQUE,
          expires_at DATETIME NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_password_reset_user_expiry (user_id, expires_at),
          CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Tabla password_reset_tokens creada');
    } catch (error) {
      console.log('❌ Error al crear tabla password_reset_tokens:', error.message);
    }
    
    // Crear tabla projects
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS projects (
          id CHAR(36) NOT NULL PRIMARY KEY,
          n INT UNSIGNED NOT NULL DEFAULT 1,
          pri VARCHAR(50) NOT NULL DEFAULT '',
          ri VARCHAR(100) NOT NULL DEFAULT '',
          rp VARCHAR(100) NULL,
          nom VARCHAR(300) NOT NULL,
          fun VARCHAR(4000) NOT NULL DEFAULT '',
          est VARCHAR(100) NOT NULL DEFAULT '',
          fre VARCHAR(200) NOT NULL DEFAULT '',
          par VARCHAR(300) NOT NULL DEFAULT '',
          fs DATE NULL,
          fj DATE NULL,
          ej VARCHAR(300) NOT NULL DEFAULT '',
          dir VARCHAR(200) NOT NULL DEFAULT '',
          prod VARCHAR(200) NOT NULL DEFAULT '',
          area VARCHAR(300) NOT NULL DEFAULT '',
          av DECIMAL(5,2) NULL,
          obs JSON NOT NULL,
          category ENUM('prio', 'susp', 'cerr', 'canc', 'esp') NOT NULL DEFAULT 'prio',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_projects_request_number (rp),
          KEY idx_projects_category_order (category, n),
          KEY idx_projects_exit_date (fs),
          KEY idx_projects_product_owner (prod)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Tabla projects creada');
    } catch (error) {
      console.log('❌ Error al crear tabla projects:', error.message);
    }
    
    // Crear tabla app_settings
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS app_settings (
          setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
          setting_value JSON NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Tabla app_settings creada');
    } catch (error) {
      console.log('❌ Error al crear tabla app_settings:', error.message);
    }
    
    // Crear tabla project_events
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS project_events (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          project_id CHAR(36) NOT NULL,
          project_name VARCHAR(300) NOT NULL,
          event_type ENUM('created', 'updated', 'category_changed', 'deleted', 'imported') NOT NULL,
          from_category ENUM('prio', 'susp', 'cerr', 'canc', 'esp') NULL,
          category ENUM('prio', 'susp', 'cerr', 'canc', 'esp') NULL,
          actor_email VARCHAR(320) NOT NULL,
          at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_project_events_project_time (project_id, at),
          KEY idx_project_events_time (at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Tabla project_events creada');
    } catch (error) {
      console.log('❌ Error al crear tabla project_events:', error.message);
    }
    
    // Verificar tablas creadas
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('Tablas finales:', tables.map(t => Object.values(t)[0]));
    
    await connection.end();
    console.log('✅ Esquema creado manualmente!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createSchema();