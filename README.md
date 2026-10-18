# Backlog Redeban

La aplicación utiliza un servidor local Node.js/Express para entregar la web y ejecutar consultas autenticadas contra una base de datos **MySQL local**. El navegador nunca se conecta directamente a MySQL. No se encontró un dump SQL en el proyecto o las carpetas inspeccionadas. Por autorización del usuario, `backend/schema.sql` define un esquema inicial acorde con los formularios y operaciones que ya existen. Solo crea tablas vacías: no genera usuarios, proyectos ni datos de prueba. Swagger se retiró y no hay enlace ni página de documentación Swagger.

## Requisitos y puesta en marcha en Windows

1. Instale Node.js 20 o posterior y MySQL Server 8.0 o posterior. En este equipo Node está instalado para el usuario actual y MySQL portable se guarda en `%LOCALAPPDATA%\Programs\MySQL-8.4-portable`; para iniciarlo en primer plano, ejecute `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-mysql.ps1` desde `backend/` y deje esa terminal abierta. El directorio de datos está en `%LOCALAPPDATA%\MySQL-Backlog-Data`. Si ya tiene MySQL como servicio de Windows, no inicie otra instancia en el puerto 3306.
2. Si todavía no creó la base de datos, en MySQL Workbench o una consola MySQL ejecute:

   ```sql
   CREATE DATABASE redeban_backlog
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_0900_ai_ci;
   ```

   Compruebe que MySQL esté escuchando con `Test-NetConnection 127.0.0.1 -Port 3306`.
3. Abra una terminal en `backend/` e instale dependencias/configure variables:

   ```powershell
   cd backend
   npm install
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

4. La configuración creada en `backend/.env` usa una cuenta de aplicación de MySQL y secretos aleatorios locales. No la sobrescriba. Si cambia de instancia MySQL, ajuste allí `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`; no ponga esas credenciales en el frontend.
   - Mantenga `CORS_ORIGINS` con el origen exacto de Live Server si decide servir la web por separado. No exponga `.env` ni use credenciales de DB en el frontend.
5. Cree las tablas vacías e inicie el backend:

   ```powershell
   npm run db:migrate
   npm start
   ```

   Deje esta terminal abierta y use `http://localhost:3000`; el estado de la conexión se puede comprobar en `http://localhost:3000/api/health`. El backend y la base de datos deben seguir ejecutándose para iniciar sesión y guardar cambios.
6. Una vez dentro, el botón **Cambiar contraseña** permite reemplazar el acceso inicial con una contraseña fuerte, incluso antes de configurar correo. El inicio de sesión ofrece **Crear cuenta** para registrar usuarios normales (perfil consulta, sin opciones administrativas) y **Olvidé mi contraseña** para solicitar un enlace por correo. Admin autorizado puede asignar los perfiles de edición en el panel. La cuenta de administrador creada en este equipo es `admin@gmail.com`; cambia inmediatamente su contraseña inicial desde el botón **Cambiar contraseña**. Para crear otra cuenta manualmente, use `npm run user:create` en una terminal interactiva. La cuenta administradora solo se habilita mientras su correo esté en `ADMIN_EMAILS`.
7. Para activar la recuperación por correo, crea una contraseña de aplicación de Google (requiere verificación en dos pasos) y escríbela en `SMTP_PASSWORD` dentro del `.env` local. El servidor ya tiene `SMTP_HOST=smtp.gmail.com`, usuario/remitente `admin@gmail.com` y puerto `587`; no compartas esa contraseña de aplicación. Verifica también que `APP_PUBLIC_URL` corresponda a la URL desde la que acceden los usuarios.

8. Abra la aplicación en `http://localhost:3000` para que la web y el backend funcionen en el mismo origen. Si la abre con Live Server en el puerto 5500, el backend debe seguir en ejecución y ese origen debe figurar en `CORS_ORIGINS`.

## Operaciones y autenticación

### Consultar los datos en MySQL Workbench

La base local se llama `redeban_backlog` y escucha en `127.0.0.1:3306`. En Workbench cree una conexión **Standard TCP/IP** con ese host y puerto, usuario `backlog_app` y la contraseña que figura como `DB_PASSWORD` en `backend/.env` (no la comparta). Seleccione `redeban_backlog` como esquema; después de conectarse, actualice **Schemas** y despliegue **Tables**. Las tablas principales son `projects`, `users`, `project_events` y `app_settings`. Las contraseñas de usuarios nunca se guardan en texto plano; no inspeccione ni comparta `password_hash`.

También puede ejecutar estas consultas en Workbench:

```sql
USE redeban_backlog;
SELECT id, n, nom, category, created_at FROM projects ORDER BY n;
SELECT name, email, profile, active FROM users ORDER BY name;
SELECT project_id, project_name, event_type, category, actor_email, at
FROM project_events ORDER BY at DESC;
```

En esta instancia comprobé que MySQL responde y que el backend autentica contra esa base. Actualmente hay una cuenta de administrador, **0 proyectos** y **0 eventos**, así que la tabla de proyectos seguirá vacía hasta que registres alguno desde la aplicación.

### Activar recuperación por correo

La URL, servidor SMTP de Gmail, puerto seguro STARTTLS, usuario y remitente ya están en `backend/.env`; lo que falta es la **contraseña de aplicación**. Inicia sesión con la cuenta de Google `admin@gmail.com`, activa la verificación en dos pasos, crea una contraseña de aplicación desde [Google App Passwords](https://myaccount.google.com/apppasswords) y guárdala como `SMTP_PASSWORD=...` en `backend/.env`. No uses la contraseña habitual de Google ni la envíes por el chat. Guarda el archivo y reinicia el backend con `Ctrl+C` y `npm start`. Hasta completar ese secreto, el formulario de recuperación muestra explícitamente que el envío no está configurado y no afirma que el correo se haya enviado.

No se incluye Swagger ni una interfaz de documentación de API. El backend sigue siendo necesario para autenticar usuarios y mantener las credenciales de MySQL fuera del navegador; sus rutas HTTP internas son las que utiliza la aplicación web.

El API implementa login, perfil, consulta/filtrado y lectura de proyectos, alta, edición, eliminación administrativa, orden, importación Excel, configuración de usuarios/listas, indicadores y línea de tiempo. Las consultas SQL usan parámetros; las categorías administrativas y la gestión de usuarios requieren perfil administrador. Administradores también deben estar incluidos en `ADMIN_EMAILS`. Las contraseñas se guardan como hash bcrypt y nunca se devuelven al frontend.

Las tablas definidas son `users`, `projects`, `app_settings` y `project_events`. Las columnas de proyectos corresponden a los campos que consume la interfaz. La línea de tiempo utiliza fechas reales de salida y eventos guardados desde esta versión; no inventa registros históricos. Firebase, sus credenciales, reglas y configuración han sido retirados.

## Archivos principales

- `frontend/`: interfaz, estilos, configuración de URL y lógica de autenticación/consultas.
- `backend/server.js`: servidor web, autenticación/autorización y endpoints internos conectados a MySQL.
- `backend/db.js`: pool y comprobación del esquema MySQL.
- `backend/schema.sql`, `backend/migrate.js`: esquema inicial y creación de tablas.
- `backend/create-user.js`: creación/actualización interactiva de cuentas con contraseña oculta.
- `backend/start-mysql.ps1`: arranque de la instancia MySQL portable de este equipo.
- `backend/.env.example`: plantilla; completar una copia local `backend/.env`.

La tabla `password_reset_tokens` almacena solo el hash de los enlaces temporales; cada enlace vence a los 30 minutos y solo puede usarse una vez. En este equipo se creó la cuenta `admin@gmail.com` solicitada; cambia la contraseña inicial insegura desde el botón **Cambiar contraseña**.
