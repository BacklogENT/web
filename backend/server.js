'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { z } = require('zod');
const { pool, verifySchema } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || '';
const publicAppUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
const adminEmails = new Set((process.env.ADMIN_EMAILS || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
const allowedOrigins = new Set((process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500,http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(value => value.trim()).filter(Boolean));
const categories = ['prio', 'susp', 'cerr', 'canc', 'esp'];
const categoryStatus = { prio: 'Activo', susp: 'Suspendido', cerr: 'Cerrado', canc: 'Cancelado', esp: 'Espera' };
const projectFields = [
  'pri', 'ri', 'rp', 'nom', 'fun', 'est', 'fre', 'par', 'fs', 'fj', 'ej',
  'dir', 'prod', 'area', 'av', 'obs', 'st', 'category'
];
const filterFields = ['pri', 'ri', 'rp', 'nom', 'fun', 'est', 'fre', 'par', 'fs', 'fj', 'ej', 'dir', 'prod', 'area', 'av', 'st'];
const defaultLists = {
  dir: ['Jenny Garzón', 'Jessica Ibáñez', 'Andrés Moreno'],
  prod: ['Vania C.', 'Javier R.', 'Miguel G.', 'Lorena C.', 'Cristian V.', 'Angie E.', 'Sofía', 'Angie G.', 'Valentina'],
  fre: ['Apoyo', 'Copi', 'Directorio', 'Normativo', 'Nuevos Casos de uso', 'Operativo', 'QR', 'Servicio', 'Transaccional', 'Valores Agregados']
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'La fecha indicada no existe.');
const emptyDateSchema = z.union([z.literal(''), dateSchema]).optional();
const boundedText = maxLength => z.union([z.string(), z.number()]).transform(String)
  .refine(value => value.length <= maxLength, `No debe superar ${maxLength} caracteres.`);
const progressSchema = z.union([
  z.number().min(0).max(100),
  z.string().regex(/^\d{1,3}$/),
  z.literal('')
]).refine(value => value === '' || Number(value) <= 100, 'El avance debe estar entre 0 y 100.');
const projectSchema = z.object({
  pri: boundedText(50).optional(),
  ri: boundedText(100).optional(),
  rp: boundedText(100).optional(),
  nom: z.string().trim().min(1).max(300),
  fun: z.string().max(4000).optional(),
  est: z.string().max(100).optional(),
  fre: z.string().max(200).optional(),
  par: z.string().max(300).optional(),
  fs: emptyDateSchema,
  fj: emptyDateSchema,
  ej: z.string().max(300).optional(),
  dir: z.string().max(200).optional(),
  prod: z.string().max(200).optional(),
  area: z.string().max(300).optional(),
  av: progressSchema.optional(),
  obs: z.array(z.object({ d: dateSchema, t: z.string().max(2000) }).strict()).max(200).optional(),
  st: z.string().max(100).optional(),
  category: z.enum(categories).optional()
}).strict();
const userSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  profile: z.enum(['edicion', 'consulta', 'administrador']),
  password: z.union([z.literal(''), z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72)]).optional()
}).strict();
const projectFilterSchema = z.object({
  category: z.enum(categories).optional(),
  field: z.enum(filterFields).optional(),
  value: z.string().max(300).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional()
}).strict();
const listsSchema = z.object({
  dir: z.array(z.string().trim().min(1).max(200)).max(200),
  prod: z.array(z.string().trim().min(1).max(200)).max(200),
  fre: z.array(z.string().trim().min(1).max(200)).max(200)
}).strict();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function escapeEmail(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw httpError(400, result.error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
  }
  return result.data;
}

function adminAllowed(email) {
  return adminEmails.has(String(email || '').trim().toLowerCase());
}

function normalizeProject(row) {
  const project = { ...row };
  project.id = String(project.id);
  project.n = Number(project.n || 0);
  project.category = categories.includes(project.category) ? project.category : 'prio';
  project.st = categoryStatus[project.category];
  project.fs = project.fs || '';
  project.fj = project.fj || '';
  project.obs = Array.isArray(project.obs) ? project.obs : [];
  return project;
}

async function authenticate(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) return next(httpError(401, 'Debe iniciar sesión para continuar.'));
  try {
    const token = jwt.verify(match[1], jwtSecret, { issuer: 'redeban-backlog' });
    const [rows] = await pool.execute(
      'SELECT id, name, email, profile FROM users WHERE id = ? AND active = 1 LIMIT 1',
      [token.sub]
    );
    const user = rows[0];
    if (!user || user.email !== token.email || (user.profile === 'administrador' && !adminAllowed(user.email))) {
      throw httpError(401, 'La sesión ya no es válida. Inicie sesión de nuevo.');
    }
    req.user = user;
    next();
  } catch (error) {
    next(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError'
      ? httpError(401, 'La sesión expiró. Inicie sesión de nuevo.')
      : error);
  }
}

function allow(...profiles) {
  return (req, res, next) => {
    if (!profiles.includes(req.user.profile) || (req.user.profile === 'administrador' && !adminAllowed(req.user.email))) {
      return next(httpError(403, 'No tiene permisos para realizar esta operación.'));
    }
    next();
  };
}

async function writeEvent(connection, project, type, actor, fromCategory = null) {
  await connection.execute(
    `INSERT INTO project_events (project_id, project_name, event_type, from_category, category, actor_email)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [project.id, project.nom, type, fromCategory, type === 'deleted' ? null : project.category, actor]
  );
}

function buildProjectFilters(query) {
  const filters = parse(projectFilterSchema, query);
  const clauses = [];
  const values = [];
  if (filters.category) {
    clauses.push('category = ?');
    values.push(filters.category);
  }
  if (filters.field && filters.value) {
    const column = filters.field === 'st' ? 'category' : filters.field;
    clauses.push(filters.field === 'st' ? "CASE category WHEN 'prio' THEN 'Activo' WHEN 'susp' THEN 'Suspendido' WHEN 'cerr' THEN 'Cerrado' WHEN 'canc' THEN 'Cancelado' ELSE 'Espera' END = ?" : `\`${column}\` = ?`);
    values.push(filters.value);
  }
  if (filters.from) {
    clauses.push('fs >= ?');
    values.push(filters.from);
  }
  if (filters.to) {
    clauses.push('fs <= ?');
    values.push(filters.to);
  }
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}

if (jwtSecret.length < 32 || jwtSecret.startsWith('replace_with_')) {
  throw new Error('Reemplace JWT_SECRET por un secreto aleatorio privado de al menos 32 caracteres en backend/.env.');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');

app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    if (!allowedOrigins.has(origin)) return res.status(403).json({ error: { message: 'Origen web no autorizado.' } });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
  styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'https://www.redeban.com'],
  connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
} } }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
const authActionLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });
const transporter = process.env.SMTP_HOST && process.env.SMTP_USER &&
  process.env.SMTP_PASSWORD && process.env.SMTP_FROM ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD || ''
  } : undefined
}) : null;

app.use(express.static(path.resolve(__dirname, '..', 'frontend')));
app.get('/api/health', asyncRoute(async (req, res) => {
  try {
    await verifySchema();
    const [[databaseRows], [userRows]] = await Promise.all([
      pool.query('SELECT DATABASE() AS databaseName'),
      pool.query('SELECT COUNT(*) AS accountCount FROM users')
    ]);
    res.json({
      data: {
        status: 'ok',
        mysql: 'connected',
        database: databaseRows[0].databaseName,
        setupRequired: Number(userRows[0].accountCount) === 0
      }
    });
  } catch (error) {
    console.error('MySQL health check failed:', error);
    res.status(503).json({ error: { message: 'No se pudo conectar a MySQL o falta aplicar backend/schema.sql.' } });
  }
}));
app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const input = parse(z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72) }).strict(), req.body);
  const email = input.email.toLowerCase();
  const [rows] = await pool.execute(
    'SELECT id, name, email, profile, password_hash, active FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  const user = rows[0];
  const valid = user && user.active && await bcrypt.compare(input.password, user.password_hash);
  if (!valid || (user.profile === 'administrador' && !adminAllowed(user.email))) {
    throw httpError(401, 'Correo o contraseña incorrectos, o cuenta sin autorización.');
  }
  const safeUser = { id: user.id, uid: user.id, name: user.name, email: user.email, profile: user.profile };
  const token = jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h', issuer: 'redeban-backlog' });
  res.json({ token, user: safeUser });
}));
app.post('/api/auth/register', authActionLimiter, asyncRoute(async (req, res) => {
  const input = parse(z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320),
    password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72)
  }).strict(), req.body);
  const email = input.email.toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    await pool.execute(
      'INSERT INTO users (id, name, email, password_hash, profile, active) VALUES (?, ?, ?, ?, ?, 1)',
      [crypto.randomUUID(), input.name, email, passwordHash, 'consulta']
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw httpError(409, 'Ya existe una cuenta con ese correo.');
    throw error;
  }
  res.status(201).json({ data: { email, profile: 'consulta' } });
}));
app.post('/api/auth/forgot-password', authActionLimiter, asyncRoute(async (req, res) => {
  const input = parse(z.object({ email: z.string().trim().email().max(320) }).strict(), req.body);
  if (!transporter) {
    throw httpError(503, 'El servidor de correo ya está configurado para Gmail, pero falta SMTP_PASSWORD en backend/.env. Agrega una contraseña de aplicación de Google (no la contraseña normal de la cuenta), verifica en dos pasos y reinicia el backend.');
  }
  const [rows] = await pool.execute(
    'SELECT id, name, email FROM users WHERE email = ? AND active = 1 LIMIT 1',
    [input.email.toLowerCase()]
  );
  if (!rows.length) return res.json({ data: { message: 'Si el correo pertenece a una cuenta activa, recibirá instrucciones para restablecer su contraseña.' } });

  const user = rows[0];
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
    await connection.execute(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))',
      [crypto.randomUUID(), user.id, tokenHash]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const resetUrl = new URL('/', `${publicAppUrl}/`);
  resetUrl.searchParams.set('resetToken', rawToken);
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: user.email,
      subject: 'Restablecimiento de contraseña - Backlog Redeban',
      text: `Hola ${user.name},\n\nUsa este enlace en los próximos 30 minutos para cambiar tu contraseña:\n${resetUrl.toString()}\n\nSi no solicitaste el cambio, ignora este mensaje.`,
      html: `<p>Hola ${escapeEmail(user.name)},</p><p><a href="${resetUrl.toString()}">Restablecer contraseña</a></p><p>El enlace vence en 30 minutos. Si no lo solicitaste, ignora este mensaje.</p>`
    });
  } catch (error) {
    await pool.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
    console.error('Password reset email delivery failed:', error.message);
    throw httpError(502, 'No se pudo enviar el correo de recuperación. Verifique la configuración SMTP del servidor.');
  }
  res.json({ data: { message: 'Si el correo pertenece a una cuenta activa, recibirá instrucciones para restablecer su contraseña.' } });
}));
app.post('/api/auth/reset-password', authActionLimiter, asyncRoute(async (req, res) => {
  const input = parse(z.object({
    token: z.string().regex(/^[a-f0-9]{64}$/i),
    password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72)
  }).strict(), req.body);
  const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT user_id FROM password_reset_tokens
       WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`,
      [tokenHash]
    );
    if (!rows.length) throw httpError(400, 'El enlace venció o ya fue utilizado. Solicita uno nuevo.');
    const userId = rows[0].user_id;
    const [updated] = await connection.execute('UPDATE users SET password_hash = ? WHERE id = ? AND active = 1', [passwordHash, userId]);
    if (!updated.affectedRows) throw httpError(400, 'La cuenta ya no está activa. Solicita ayuda al administrador.');
    await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ data: { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' } });
}));
app.use('/api', authenticate);

app.post('/api/auth/change-password', asyncRoute(async (req, res) => {
  const input = parse(z.object({
    currentPassword: z.string().min(1).max(72),
    newPassword: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72)
  }).strict(), req.body);
  const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ? AND active = 1 LIMIT 1', [req.user.id]);
  if (!rows.length || !await bcrypt.compare(input.currentPassword, rows[0].password_hash)) {
    throw httpError(400, 'La contraseña actual no es correcta.');
  }
  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
    await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [req.user.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ data: { message: 'Tu contraseña se actualizó correctamente.' } });
}));

app.get('/api/me', (req, res) => res.json({ ...req.user, uid: req.user.id }));

app.get('/api/config', asyncRoute(async (req, res) => {
  const [settingRows] = await pool.execute('SELECT setting_value FROM app_settings WHERE setting_key = ?', ['lists']);
  const lists = settingRows.length ? settingRows[0].setting_value : defaultLists;
  let users = [];
  if (req.user.profile === 'administrador' && adminAllowed(req.user.email)) {
    const [userRows] = await pool.query('SELECT name, email, profile FROM users WHERE active = 1 ORDER BY name');
    users = userRows.filter(user => user.profile !== 'administrador' || adminAllowed(user.email));
  }
  res.json({ data: { ...defaultLists, ...lists, users } });
}));

app.put('/api/config', allow('administrador'), asyncRoute(async (req, res) => {
  const input = parse(z.object({ users: z.array(userSchema).max(500), ...listsSchema.shape }).strict(), req.body);
  const users = input.users.map(user => ({ ...user, email: user.email.toLowerCase() }));
  if (new Set(users.map(user => user.email)).size !== users.length) throw httpError(400, 'Hay correos duplicados.');
  if (new Set(users.map(user => user.name.trim().toLowerCase())).size !== users.length) throw httpError(400, 'Hay nombres de usuario duplicados.');
  if (!users.some(user => user.email === req.user.email && user.profile === 'administrador')) {
    throw httpError(400, 'No puede eliminar o degradar su propia cuenta administradora.');
  }
  if (users.some(user => user.profile === 'administrador' && !adminAllowed(user.email))) {
    throw httpError(400, 'Cada cuenta administradora debe estar incluida en ADMIN_EMAILS.');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query('SELECT id, email, active FROM users FOR UPDATE');
    const existingByEmail = new Map(existingRows.map(user => [user.email, user]));
    const retainedEmails = [];
    for (const user of users) {
      const existing = existingByEmail.get(user.email);
      if ((!existing || !existing.active) && !user.password) {
        throw httpError(400, `Ingrese una contraseña nueva de al menos 12 caracteres para ${user.email}.`);
      }
      const userId = existing?.id || crypto.randomUUID();
      const profile = user.profile;
      if (user.password) {
        const passwordHash = await bcrypt.hash(user.password, 12);
        await connection.execute(
          `INSERT INTO users (id, name, email, password_hash, profile, active)
           VALUES (?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), profile = VALUES(profile), active = 1`,
          [userId, user.name, user.email, passwordHash, profile]
        );
      } else {
        await connection.execute(
          'UPDATE users SET name = ?, profile = ?, active = 1 WHERE id = ?',
          [user.name, profile, userId]
        );
      }
      retainedEmails.push(user.email);
    }
    if (retainedEmails.length) {
      const placeholders = retainedEmails.map(() => '?').join(', ');
      await connection.execute(`UPDATE users SET active = 0 WHERE email NOT IN (${placeholders})`, retainedEmails);
    } else {
      await connection.execute('UPDATE users SET active = 0');
    }
    await connection.execute(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      ['lists', JSON.stringify({ dir: input.dir, prod: input.prod, fre: input.fre })]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ data: { users: users.map(({ name, email, profile }) => ({ name, email, profile })), dir: input.dir, prod: input.prod, fre: input.fre } });
}));

app.get('/api/projects', asyncRoute(async (req, res) => {
  const { where, values } = buildProjectFilters(req.query);
  const [rows] = await pool.execute(`SELECT * FROM projects${where} ORDER BY n, created_at, id`, values);
  res.json({ data: rows.map(normalizeProject) });
}));

app.get('/api/projects/:id/history', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT project_id AS projectId, project_name AS projectName, event_type AS type, from_category AS fromCategory, category, actor_email AS actor, at FROM project_events WHERE project_id = ? ORDER BY at LIMIT 500',
    [req.params.id]
  );
  res.json({ data: rows.map(row => ({ ...row, typeLabel: ({ created: 'Proyecto registrado', updated: 'Proyecto actualizado', category_changed: 'Categoría actualizada', deleted: 'Proyecto eliminado', imported: 'Proyecto importado' })[row.type] || row.type, at: row.at ? new Date(row.at).toISOString() : null })) });
}));

app.get('/api/projects/:id', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM projects WHERE id = ? LIMIT 1', [req.params.id]);
  if (!rows.length) throw httpError(404, 'Proyecto no encontrado.');
  res.json({ data: normalizeProject(rows[0]) });
}));

function projectValues(project, id, category, position) {
  return [
    id, position, project.pri || '', project.ri || '', project.rp || null, project.nom,
    project.fun || '', project.est || '', project.fre || '', project.par || '',
    project.fs || null, project.fj || null, project.ej || '', project.dir || '',
    project.prod || '', project.area || '', project.av === '' || project.av == null ? null : Number(project.av),
    JSON.stringify(project.obs || []), category
  ];
}

const projectColumns = 'id, n, pri, ri, rp, nom, fun, est, fre, par, fs, fj, ej, dir, prod, area, av, obs, category';
const insertProjectSql = `INSERT INTO projects (${projectColumns}) VALUES (${Array(19).fill('?').join(', ')})`;

async function ensureUniqueRequirement(connection, requestNumber, id = null) {
  if (!requestNumber) return;
  const [rows] = await connection.execute(
    `SELECT id FROM projects WHERE rp = ?${id ? ' AND id <> ?' : ''} LIMIT 1`,
    id ? [requestNumber, id] : [requestNumber]
  );
  if (rows.length) throw httpError(409, 'El número de requerimiento ya está asignado a otro proyecto.');
}

app.post('/api/projects', allow('edicion', 'administrador'), asyncRoute(async (req, res) => {
  const input = parse(projectSchema, req.body);
  if (input.category && input.category !== 'prio' && req.user.profile !== 'administrador') {
    throw httpError(403, 'Solo el administrador puede asignar la categoría.');
  }
  const project = { ...input, id: crypto.randomUUID(), category: req.user.profile === 'administrador' ? input.category || 'prio' : 'prio' };
  if (req.user.profile === 'edicion') project.prod = req.user.name;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureUniqueRequirement(connection, project.rp);
    const [countRows] = await connection.execute('SELECT COALESCE(MAX(n), 0) + 1 AS nextPosition FROM projects WHERE category = ?', [project.category]);
    await connection.execute(insertProjectSql, projectValues(project, project.id, project.category, countRows[0].nextPosition));
    await writeEvent(connection, project, 'created', req.user.email);
    const [rows] = await connection.execute('SELECT * FROM projects WHERE id = ?', [project.id]);
    await connection.commit();
    res.status(201).json({ data: normalizeProject(rows[0]) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.patch('/api/projects/order', allow('administrador'), asyncRoute(async (req, res) => {
  const parsed = parse(z.object({ ids: z.array(z.string().uuid()).max(1000) }).strict(), req.body);
  if (new Set(parsed.ids).size !== parsed.ids.length) throw httpError(400, 'La lista contiene identificadores duplicados.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [index, id] of parsed.ids.entries()) {
      await connection.execute('UPDATE projects SET n = ? WHERE id = ? AND category = ?', [index + 1, id, 'prio']);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ data: { updated: parsed.ids.length } });
}));

app.patch('/api/projects/:id', asyncRoute(async (req, res) => {
  const input = parse(projectSchema.partial(), req.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute('SELECT * FROM projects WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!existingRows.length) throw httpError(404, 'Proyecto no encontrado.');
    const previous = normalizeProject(existingRows[0]);
    if (req.user.profile !== 'administrador' &&
        !(req.user.profile === 'edicion' && previous.category === 'prio' && String(previous.prod).trim().toLowerCase() === req.user.name.trim().toLowerCase())) {
      throw httpError(403, 'Solo puede editar proyectos priorizados asignados a su nombre.');
    }
    if ((input.category && input.category !== previous.category || input.st) && req.user.profile !== 'administrador') {
      throw httpError(403, 'Solo el administrador puede cambiar la categoría administrativa.');
    }
    const updated = { ...previous, ...input, category: input.category || previous.category };
    if (req.user.profile === 'edicion') updated.prod = req.user.name;
    await ensureUniqueRequirement(connection, updated.rp, req.params.id);
    await connection.execute(
      `UPDATE projects SET pri = ?, ri = ?, rp = ?, nom = ?, fun = ?, est = ?, fre = ?, par = ?, fs = ?, fj = ?, ej = ?, dir = ?, prod = ?, area = ?, av = ?, obs = ?, category = ?, n = ? WHERE id = ?`,
      [updated.pri || '', updated.ri || '', updated.rp || null, updated.nom, updated.fun || '', updated.est || '',
        updated.fre || '', updated.par || '', updated.fs || null, updated.fj || null, updated.ej || '',
        updated.dir || '', updated.prod || '', updated.area || '', updated.av === '' || updated.av == null ? null : Number(updated.av),
        JSON.stringify(updated.obs || []), updated.category, previous.category === updated.category ? previous.n : 1, req.params.id]
    );
    await writeEvent(connection, updated, previous.category === updated.category ? 'updated' : 'category_changed', req.user.email, previous.category);
    const [rows] = await connection.execute('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    await connection.commit();
    res.json({ data: normalizeProject(rows[0]) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.delete('/api/projects/:id', allow('administrador'), asyncRoute(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM projects WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rows.length) throw httpError(404, 'Proyecto no encontrado.');
    const project = normalizeProject(rows[0]);
    await writeEvent(connection, project, 'deleted', req.user.email, project.category);
    await connection.execute('DELETE FROM projects WHERE id = ?', [req.params.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(204).end();
}));

app.put('/api/projects/import/:category', allow('administrador'), asyncRoute(async (req, res) => {
  const category = parse(z.enum(categories), req.params.category);
  const rows = parse(z.array(projectSchema.extend({ id: z.string().uuid().optional() })).max(400), req.body?.rows);
  if (rows.some(project => project.category && project.category !== category)) {
    throw httpError(400, 'Cada proyecto importado debe coincidir con el módulo seleccionado.');
  }
  const ids = rows.map(project => project.id || crypto.randomUUID());
  if (new Set(ids).size !== ids.length) throw httpError(409, 'El archivo contiene identificadores duplicados.');
  const requestNumbers = rows.map(project => String(project.rp || '').trim().toLowerCase()).filter(Boolean);
  if (new Set(requestNumbers).size !== requestNumbers.length) throw httpError(409, 'El archivo contiene números de requerimiento duplicados.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [otherRows] = await connection.execute('SELECT id, rp FROM projects WHERE category <> ?', [category]);
    const otherIds = new Set(otherRows.map(project => project.id));
    const otherNumbers = new Set(otherRows.map(project => String(project.rp || '').trim().toLowerCase()).filter(Boolean));
    if (ids.some(id => otherIds.has(id)) || requestNumbers.some(number => otherNumbers.has(number))) {
      throw httpError(409, 'El archivo contiene identificadores o números de requerimiento ya existentes en otra categoría.');
    }
    await connection.execute('DELETE FROM projects WHERE category = ?', [category]);
    for (const [index, row] of rows.entries()) {
      const project = { ...row, id: ids[index], category };
      await connection.execute(insertProjectSql, projectValues(project, project.id, category, index + 1));
      await writeEvent(connection, project, 'imported', req.user.email);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ data: { imported: rows.length, category } });
}));

app.get('/api/stats', asyncRoute(async (req, res) => {
  const { where, values } = buildProjectFilters(req.query);
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total,
      SUM(category = 'prio') AS prio, SUM(category = 'susp') AS susp,
      SUM(category = 'cerr') AS cerr, SUM(category = 'canc') AS canc, SUM(category = 'esp') AS esp,
      SUM(category = 'prio' AND est = 'Definiciones') AS definitions,
      SUM(category = 'prio' AND est = 'Estimación') AS estimation,
      SUM(category = 'prio' AND est = 'Diseño') AS design,
      SUM(category = 'prio' AND est = 'Ejecución QA') AS qa,
      SUM(category = 'prio' AND est = 'Ejecución Producción') AS production
     FROM projects${where}`,
    values
  );
  const row = rows[0];
  res.json({ data: { total: Number(row.total), categories: Object.fromEntries(categories.map(key => [key, Number(row[key]) || 0])), stages: {
    Definiciones: Number(row.definitions) || 0, Estimación: Number(row.estimation) || 0,
    Diseño: Number(row.design) || 0, 'Ejecución QA': Number(row.qa) || 0,
    'Ejecución Producción': Number(row.production) || 0
  } } });
}));

app.get('/api/timeline', asyncRoute(async (req, res) => {
  const parsed = parse(z.object({ year: z.coerce.number().int().min(2000).max(2200).optional() }).strict(), req.query);
  const year = parsed.year || new Date().getFullYear();
  const [monthlyRows] = await pool.execute(
    'SELECT MONTH(fs) AS monthNumber, COUNT(*) AS count FROM projects WHERE fs >= ? AND fs < ? GROUP BY MONTH(fs)',
    [`${year}-01-01`, `${year + 1}-01-01`]
  );
  const estimatedByMonth = Array.from({ length: 12 }, (_, month) => ({ month: new Date(year, month, 1).toLocaleString('es-CO', { month: 'long' }), count: 0 }));
  monthlyRows.forEach(row => { estimatedByMonth[Number(row.monthNumber) - 1].count = Number(row.count); });
  const [eventRows] = await pool.execute(
    `SELECT project_id AS projectId, project_name AS projectName, event_type AS type,
      from_category AS fromCategory, category, actor_email AS actor, at
     FROM project_events WHERE at >= ? AND at < ? ORDER BY at LIMIT 1000`,
    [`${year}-01-01 00:00:00`, `${year + 1}-01-01 00:00:00`]
  );
  const events = eventRows.map(row => ({
    ...row, at: row.at ? new Date(row.at).toISOString() : null,
    typeLabel: ({ created: 'Proyecto registrado', updated: 'Proyecto actualizado', category_changed: 'Categoría actualizada', deleted: 'Proyecto eliminado', imported: 'Proyecto importado' })[row.type] || row.type
  }));
  res.json({ data: { year, estimatedByMonth, events, historicalEventsAvailable: events.length > 0 } });
}));

app.use((req, res, next) => next(httpError(404, 'Recurso no encontrado.')));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.status) || (error.code === 'ER_DUP_ENTRY' ? 409 : 500);
  if (status >= 500) console.error('API/MySQL error:', error);
  const message = status === 409 && error.code === 'ER_DUP_ENTRY'
    ? 'El correo o número de requerimiento ya está en uso.'
    : status === 500 ? 'Error interno al consultar o guardar datos en MySQL.' : error.message;
  res.status(status).json({ error: { message } });
});

async function start() {
  app.listen(port, () => {
    console.log(`Backlog disponible en http://localhost:${port}`);
    verifySchema().then(
      () => console.log('Conexión con MySQL verificada.'),
      error => console.error('MySQL no está disponible o falta el esquema. La página abre, pero el login y los datos requieren corregirlo:', error.message)
    );
  });
}

start().catch(error => {
  console.error('No se pudo iniciar Backlog. Revise backend/.env y las dependencias instaladas.', error.message);
  process.exitCode = 1;
});
