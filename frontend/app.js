'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const API_BASE_URL = String(window.APP_CONFIG?.apiBaseUrl || window.location.origin).replace(/\/+$/, '');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const MODULES = {
  prio: 'Proyectos priorizados',
  susp: 'Proyectos Suspendidos',
  cerr: 'Proyectos Cerrados',
  canc: 'Proyectos Cancelados',
  esp: 'Proyectos en Espera'
};
const CATEGORY_STATUS = { susp: 'Suspendido', cerr: 'Cerrado', canc: 'Cancelado', esp: 'Espera' };
const STAGES = ['Definiciones', 'Estimación', 'Diseño', 'Ejecución QA', 'Ejecución Producción'];
const STAGE_ICON = { 'Definiciones': '📝', 'Estimación': '📊', 'Diseño': '🎨', 'Ejecución QA': '🧪', 'Ejecución Producción': '🚀' };
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DEFAULTS = {
  dir: ['Jenny Garzón', 'Jessica Ibáñez', 'Andrés Moreno'],
  prod: ['Vania C.', 'Javier R.', 'Miguel G.', 'Lorena C.', 'Cristian V.', 'Angie E.', 'Sofía', 'Angie G.', 'Valentina'],
  fre: ['Apoyo', 'Copi', 'Directorio', 'Normativo', 'Nuevos Casos de uso', 'Operativo', 'QR', 'Servicio', 'Transaccional', 'Valores Agregados']
};
const COLUMNS = [
  { key: 'n', label: 'Nivel priorización', type: 'auto' },
  { key: 'pri', label: 'Prioridad', type: 'select', options: ['1Q', '2Q', '3Q', '4Q', 'Especial'] },
  { key: 'ri', label: '# Req Inicial' },
  { key: 'rp', label: '# Req Proyecto' },
  { key: 'nom', label: 'Nombre proyecto', wide: true, required: true },
  { key: 'fun', label: 'Funcionalidad', wide: true },
  { key: 'est', label: 'Estado', formLabel: 'Estado (etapa)', type: 'select', options: STAGES },
  { key: 'fre', label: 'Frente', type: 'select', options: 'fre' },
  { key: 'par', label: 'Participante' },
  { key: 'fs', label: 'Fecha estimada salida', type: 'date' },
  { key: 'mes', label: 'Mes salida', type: 'auto' },
  { key: 'fj', label: 'Fecha cierre Jira', type: 'date' },
  { key: 'ej', label: 'Estado Jira' },
  { key: 'dir', label: 'Responsable Dirección', type: 'select', options: 'dir' },
  { key: 'prod', label: 'Responsable producto', type: 'select', options: 'prod' },
  { key: 'area', label: 'Área Técnica líder' },
  { key: 'av', label: '% Avance', type: 'number' },
  { key: 'obs', label: 'Observaciones', type: 'comments', wide: true },
  { key: 'st', label: 'Estado', formLabel: 'Estado (situación)', type: 'category' }
];
const FILTER_FIELDS = [
  ['fre', 'Frente'], ['area', 'Área Técnica líder'], ['par', 'Participante'],
  ['dir', 'Responsable Dirección'], ['prod', 'Responsable producto']
];

let sessionToken = null;
let currentProfile = null;
let authScreen = new URLSearchParams(window.location.search).has('resetToken') ? 'reset' : 'login';
let recoveryToken = new URLSearchParams(window.location.search).get('resetToken') || '';
let projects = [];
let config = { users: [], ...DEFAULTS };
let page = 'prio';
let filters = { module: 'prio', field: 'fre', value: '', from: '', to: '' };
let timelineYear = new Date().getFullYear();
let refreshTimer;

const isAdmin = () => currentProfile?.profile === 'administrador';
const isEditor = () => currentProfile?.profile === 'edicion' || isAdmin();
const canEditProject = project => isAdmin() ||
  (currentProfile?.profile === 'edicion' && project.category === 'prio' &&
    String(project.prod || '').trim().toLowerCase() === currentProfile.name.trim().toLowerCase());
const notify = (message, error = false) => {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.toggle('notice-error', error);
};
const clearNotice = () => {
  $('#notice').textContent = '';
  $('#notice').classList.remove('notice-error');
};
const today = () => new Date().toISOString().slice(0, 10);
const monthOf = date => date ? MONTHS[Number(date.slice(5, 7)) - 1] || '' : '';

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  let response;
  try {
    response = await fetch(new URL(path, `${API_BASE_URL}/`), { ...options, headers });
  } catch {
    throw new Error(`No responde el servidor local ${API_BASE_URL}. Inicia MySQL y el backend con "npm start" y abre la aplicación en http://localhost:3000.`);
  }
  let result = null;
  if (response.status !== 204) {
    try {
      result = await response.json();
    } catch {
      throw new Error(`El servidor ${API_BASE_URL} no es la aplicación Backlog. Inicia el backend y abre http://localhost:3000.`);
    }
  }
  if (!response.ok) {
    if (response.status === 401 && sessionToken) {
      logout();
      currentProfile = null;
    }
    throw new Error(result?.error?.message || result?.message || `Error API (${response.status})`);
  }
  return result;
}

async function initialize() {
  render();
  sessionToken = sessionStorage.getItem('backlogToken');
  try {
    const health = await api('/api/health');
    if (health.data.setupRequired) {
      notify('La base de datos ya está conectada, pero todavía no hay cuentas. En una terminal abierta en backend/, ejecuta npm run user:create para crear la tuya.', true);
    } else {
      clearNotice();
    }
  } catch (error) {
    notify(error.message, true);
  }
  if (!sessionToken) return;
  try {
    currentProfile = await api('/api/me');
    await refreshData();
    clearNotice();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (page !== 'admin') refreshData().catch(error => notify(error.message, true));
    }, 60000);
  } catch (error) {
    if (sessionToken) notify(error.message, true);
  }
  render();
}

async function refreshData() {
  const [projectResponse, configResponse] = await Promise.all([
    api('/api/projects'),
    api('/api/config')
  ]);
  projects = projectResponse.data;
  config = { ...DEFAULTS, ...configResponse.data, users: configResponse.data.users || [] };
  render();
  if (page === 'stats') await loadStats();
  if (page === 'timeline') await loadTimeline();
}

function nav() {
  const tabs = [...Object.entries(MODULES), ['query', 'Consulta'], ['stats', 'Cifras'], ['timeline', 'Línea en el tiempo'], ['admin', 'Administrador']]
    .filter(([key]) => key !== 'admin' || isAdmin());
  return `<nav aria-label="Secciones">${tabs.map(([key, label]) =>
    `<button type="button" data-page="${key}" class="${page === key ? 'active' : ''}">${label}</button>`
  ).join('')}<button type="button" data-action="change-password">Cambiar contraseña</button><button type="button" data-action="logout" class="logout">Salir</button></nav>`;
}

function render() {
  const app = $('#app');
  if (!sessionToken || !currentProfile) {
    $('#who').textContent = '';
    const screens = {
      login: `<h2>Backlog</h2><p>Ingrese con su cuenta autorizada del sistema.</p>
        <form id="login-form">
          <label class="sr-only" for="email">Correo electrónico</label>
          <input id="email" name="email" type="email" autocomplete="username" placeholder="correo@redeban.com.co" required>
          <label class="sr-only" for="password">Contraseña</label>
          <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Contraseña" required>
          <div id="login-error" class="error" role="alert"></div><button type="submit">Ingresar</button>
        </form>
        <div class="login-options">
          <button type="button" class="link-button" data-auth-screen="forgot">Olvidé mi contraseña</button>
          <button type="button" class="link-button" data-auth-screen="register">Crear cuenta</button>
        </div>
        <p class="muted">Los permisos administrativos solo los asigna un administrador autorizado.</p>`,
      register: `<h2>Crear cuenta</h2><p>Las cuentas nuevas tienen permisos de consulta. Un administrador puede asignar permisos adicionales.</p>
        <form id="register-form">
          <label for="register-name">Nombre</label><input id="register-name" name="name" autocomplete="name" maxlength="200" required>
          <label for="register-email">Correo electrónico</label><input id="register-email" name="email" type="email" autocomplete="email" required>
          <label for="register-password">Contraseña (mínimo 12 caracteres)</label><input id="register-password" name="password" type="password" autocomplete="new-password" minlength="12" required>
          <div id="register-error" class="error" role="alert"></div><button type="submit">Crear cuenta</button>
        </form><button type="button" class="link-button" data-auth-screen="login">Volver al inicio de sesión</button>`,
      forgot: `<h2>Recuperar contraseña</h2><p>Te enviaremos un enlace de un solo uso que vence en 30 minutos.</p>
        <form id="forgot-form">
          <label for="forgot-email">Correo electrónico</label><input id="forgot-email" name="email" type="email" autocomplete="email" required>
          <div id="forgot-error" class="error" role="alert"></div><button type="submit">Enviar enlace</button>
        </form><button type="button" class="link-button" data-auth-screen="login">Volver al inicio de sesión</button>`,
      reset: `<h2>Nueva contraseña</h2><p>Elige una contraseña de al menos 12 caracteres.</p>
        <form id="reset-form">
          <label for="reset-password">Contraseña nueva</label><input id="reset-password" name="password" type="password" autocomplete="new-password" minlength="12" required>
          <label for="reset-confirm">Confirmar contraseña</label><input id="reset-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required>
          <div id="reset-error" class="error" role="alert"></div><button type="submit">Cambiar contraseña</button>
        </form>`,
      registrationComplete: `<h2>Cuenta creada</h2><p>Tu cuenta se creó con permisos de consulta. Ya puedes iniciar sesión.</p>
        <button type="button" data-auth-screen="login">Ir a iniciar sesión</button>`
    };
    app.innerHTML = `<section class="login">
      <img src="https://www.redeban.com/sites/default/files/Logo.png" alt="Redeban">
      ${screens[authScreen] || screens.login}
    </section>`;
    $('#login-form')?.addEventListener('submit', login);
    $('#register-form')?.addEventListener('submit', register);
    $('#forgot-form')?.addEventListener('submit', requestPasswordReset);
    $('#reset-form')?.addEventListener('submit', resetPassword);
    document.querySelectorAll('[data-auth-screen]').forEach(button => button.addEventListener('click', () => {
      authScreen = button.dataset.authScreen;
      render();
    }));
    return;
  }
  $('#who').textContent = `${currentProfile.name} · ${currentProfile.profile}`;
  const content = page in MODULES ? moduleView(page) :
    page === 'query' ? queryView() :
    page === 'stats' ? statsView() :
    page === 'timeline' ? timelineView() : adminView();
  app.innerHTML = `${nav()}<main>${content}</main>`;
  bindPageEvents();
}

function bindPageEvents() {
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
    page = button.dataset.page;
    render();
    if (page === 'stats') loadStats().catch(error => notify(error.message, true));
    if (page === 'timeline') loadTimeline().catch(error => notify(error.message, true));
  }));
  document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
  document.querySelector('[data-action="change-password"]')?.addEventListener('click', openPasswordChange);
  $('#change-password-form')?.addEventListener('submit', changePassword);
  $('#login-form')?.addEventListener('submit', login);
  $('#register-form')?.addEventListener('submit', register);
  $('#forgot-form')?.addEventListener('submit', requestPasswordReset);
  $('#reset-form')?.addEventListener('submit', resetPassword);
  $('#project-form')?.addEventListener('submit', saveProject);
  $('#admin-config-form')?.addEventListener('submit', saveAdminConfig);
  $('#import-form')?.addEventListener('submit', importExcel);
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.edit)));
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteProject(button.dataset.delete)));
  document.querySelectorAll('[data-action="refresh"]').forEach(button => button.addEventListener('click', () => refreshData().catch(error => notify(error.message, true))));
  document.querySelector('[data-action="add-user"]')?.addEventListener('click', () => {
    updateAdminUsers();
    config.users.push({ name: '', email: '', profile: 'consulta', password: '' });
    render();
  });
  document.querySelectorAll('[data-remove-user]').forEach(button => button.addEventListener('click', () => {
    updateAdminUsers();
    config.users.splice(Number(button.dataset.removeUser), 1);
    render();
  }));
  document.querySelectorAll('[data-action="new"]').forEach(button => button.addEventListener('click', () => openEditor()));
  document.querySelectorAll('[data-filter]').forEach(control => control.addEventListener('change', () => {
    filters[control.dataset.filter] = control.value;
    if (control.dataset.filter === 'module' || control.dataset.filter === 'field') filters.value = '';
    render();
    if (page === 'stats') loadStats().catch(error => notify(error.message, true));
  }));
  $('#timeline-year')?.addEventListener('change', event => {
    timelineYear = Number(event.target.value);
    loadTimeline().catch(error => notify(error.message, true));
  });
  $('#export-button')?.addEventListener('click', exportExcel);
  $('#xlsx-file')?.addEventListener('change', () => {});
  $('#module-select')?.addEventListener('change', event => { filters.module = event.target.value; });
  const tableBody = $('tbody[data-reorder]');
  if (tableBody && isAdmin()) bindReordering(tableBody);
}

async function login(event) {
  event.preventDefault();
  const errorBox = $('#login-error');
  errorBox.textContent = '';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#email').value.trim(), password: $('#password').value })
    });
    sessionToken = result.token;
    sessionStorage.setItem('backlogToken', sessionToken);
    currentProfile = result.user;
    await refreshData();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (page !== 'admin') refreshData().catch(error => notify(error.message, true));
    }, 60000);
    clearNotice();
    render();
  } catch (error) {
    sessionStorage.removeItem('backlogToken');
    sessionToken = null;
    currentProfile = null;
    render();
    $('#login-error').textContent = error.message;
  }
}

async function register(event) {
  event.preventDefault();
  const errorBox = $('#register-error');
  errorBox.textContent = '';
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#register-name').value.trim(),
        email: $('#register-email').value.trim(),
        password: $('#register-password').value
      })
    });
    authScreen = 'registrationComplete';
    render();
  } catch (error) {
    errorBox.textContent = error.message;
  }
}

async function requestPasswordReset(event) {
  event.preventDefault();
  const errorBox = $('#forgot-error');
  errorBox.textContent = '';
  try {
    const result = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: $('#forgot-email').value.trim() })
    });
    notify(result.data.message);
    authScreen = 'login';
    render();
  } catch (error) {
    errorBox.textContent = error.message;
  }
}

async function resetPassword(event) {
  event.preventDefault();
  const errorBox = $('#reset-error');
  errorBox.textContent = '';
  const password = $('#reset-password').value;
  if (password !== $('#reset-confirm').value) {
    errorBox.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  try {
    const result = await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: recoveryToken, password })
    });
    recoveryToken = '';
    authScreen = 'login';
    window.history.replaceState({}, '', window.location.pathname);
    render();
    notify(result.data.message);
  } catch (error) {
    errorBox.textContent = error.message;
  }
}

function openPasswordChange() {
  const dialog = $('#dlg');
  dialog.innerHTML = `<h2 id="dialog-title">Cambiar contraseña</h2>
    <form id="change-password-form">
      <label for="current-password">Contraseña actual</label><input id="current-password" type="password" autocomplete="current-password" required>
      <label for="new-password">Contraseña nueva (mínimo 12 caracteres)</label><input id="new-password" type="password" autocomplete="new-password" minlength="12" required>
      <label for="confirm-new-password">Confirmar contraseña nueva</label><input id="confirm-new-password" type="password" autocomplete="new-password" minlength="12" required>
      <div id="change-password-error" class="error" role="alert"></div>
      <div class="bar"><button type="submit">Guardar contraseña</button><button type="button" class="secondary" data-action="close-password-dialog">Cancelar</button></div>
    </form>`;
  $('#change-password-form').addEventListener('submit', changePassword);
  $('[data-action="close-password-dialog"]').addEventListener('click', () => dialog.close());
  dialog.showModal();
}

async function changePassword(event) {
  event.preventDefault();
  const errorBox = $('#change-password-error');
  errorBox.textContent = '';
  const newPassword = $('#new-password').value;
  if (newPassword !== $('#confirm-new-password').value) {
    errorBox.textContent = 'Las contraseñas nuevas no coinciden.';
    return;
  }
  try {
    const result = await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('#current-password').value,
        newPassword
      })
    });
    $('#dlg').close();
    notify(result.data.message);
  } catch (error) {
    errorBox.textContent = error.message;
  }
}

function logout() {
  clearInterval(refreshTimer);
  sessionStorage.removeItem('backlogToken');
  sessionToken = null;
  currentProfile = null;
  projects = [];
  render();
}

function filteredProjects(module = filters.module) {
  return projects.filter(project => {
    if (project.category !== module) return false;
    if (filters.value && project[filters.field] !== filters.value) return false;
    if (filters.from && (!project.fs || project.fs < filters.from)) return false;
    if (filters.to && (!project.fs || project.fs > filters.to)) return false;
    return true;
  });
}

function distinctValues(key) {
  const col = COLUMNS.find(item => item.key === key);
  const options = col?.type === 'select'
    ? (Array.isArray(col.options) ? col.options : config[col.options] || [])
    : [];
  return [...new Set([...options, ...projects.map(project => project[key]).filter(Boolean)])].sort();
}

function filterControls(includeModule) {
  const moduleControl = includeModule
    ? `<label>Módulo <select data-filter="module">${Object.entries(MODULES).map(([key, label]) => `<option value="${key}" ${filters.module === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`
    : '';
  return `<div class="bar">${moduleControl}
    <label>Filtrar por <select data-filter="field">${FILTER_FIELDS.map(([key, label]) => `<option value="${key}" ${filters.field === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label>Valor <select data-filter="value"><option value="">(Todos)</option>${distinctValues(filters.field).map(value => `<option value="${escapeHtml(value)}" ${filters.value === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>
    <label>Salida desde <input data-filter="from" type="date" value="${escapeHtml(filters.from)}"></label>
    <label>Salida hasta <input data-filter="to" type="date" value="${escapeHtml(filters.to)}"></label>
  </div>`;
}

function cellValue(column, project, index) {
  if (column.key === 'n') return index + 1;
  if (column.key === 'mes') return escapeHtml(monthOf(project.fs));
  if (column.key === 'st') return escapeHtml(CATEGORY_STATUS[project.category] || 'Activo');
  if (column.key === 'obs') {
    const comments = project.obs || [];
    const last = comments[comments.length - 1];
    return last ? `<span title="${escapeHtml(comments.map(item => `${item.d}: ${item.t}`).join('\n'))}">(${comments.length}) <b>${escapeHtml(last.d)}</b> ${escapeHtml(last.t.slice(0, 60))}</span>` : '';
  }
  return escapeHtml(project[column.key] ?? '');
}

function table(rows, reorder = false) {
  const headers = COLUMNS.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
  const body = rows.map((project, index) => `<tr data-project-id="${escapeHtml(project.id)}" ${reorder ? 'draggable="true"' : ''}>
    ${COLUMNS.map(column => `<td>${cellValue(column, project, index)}</td>`).join('')}
    <td class="actions">${canEditProject(project) ? `<button type="button" data-edit="${escapeHtml(project.id)}" aria-label="Editar ${escapeHtml(project.nom)}">Editar</button>` : ''}
    ${isAdmin() ? `<button type="button" class="secondary" data-delete="${escapeHtml(project.id)}" aria-label="Eliminar ${escapeHtml(project.nom)}">Eliminar</button>` : ''}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${headers}<th>Acciones</th></tr></thead><tbody ${reorder ? 'data-reorder="true"' : ''}>${body || `<tr><td class="empty" colspan="${COLUMNS.length + 1}">Sin registros</td></tr>`}</tbody></table></div>`;
}

function moduleView(module) {
  const rows = projects.filter(project => project.category === module);
  const canAdd = module === 'prio' && isEditor();
  return `<h2>${MODULES[module]}</h2><div class="bar">
    ${canAdd ? '<button type="button" data-action="new">+ Nuevo proyecto</button>' : ''}
    ${isAdmin() ? '<button type="button" class="secondary" data-action="refresh">Actualizar</button>' : ''}
    ${!isEditor() ? '<span class="hint">Perfil consulta: solo lectura</span>' : ''}
    ${currentProfile.profile === 'edicion' ? '<span class="hint">Solo puede crear y editar proyectos asignados a su nombre.</span>' : ''}
    ${isAdmin() && module === 'prio' ? '<span class="hint">Puede arrastrar filas para reordenarlas.</span>' : ''}
  </div>${table(rows, isAdmin() && module === 'prio')}`;
}

function openEditor(id = '') {
  const project = id ? projects.find(item => item.id === id) : { obs: [], st: 'Activo', av: 0 };
  if (!project || (id && !canEditProject(project))) return;
  const fields = COLUMNS.filter(column => !['n', 'mes'].includes(column.key)).map(column => {
    const value = project[column.key] ?? '';
    const label = column.formLabel || column.label;
    const wide = column.wide ? 'wide' : '';
    if (column.type === 'comments') return `<div class="wide">
      <b>Observaciones</b><div class="comments">${(project.obs || []).map(item => `<p class="comment"><b>${escapeHtml(item.d)}</b> — ${escapeHtml(item.t)}</p>`).join('') || '<i>Sin comentarios</i>'}</div>
      <label>Nuevo comentario <textarea id="field-obs" rows="2"></textarea></label><label>Fecha del comentario <input id="comment-date" type="date" value="${today()}"></label>
    </div>`;
    if (column.key === 'prod' && currentProfile.profile === 'edicion') {
      return `<label class="${wide}">${label}<input id="field-prod" value="${escapeHtml(currentProfile.name)}" readonly></label>`;
    }
    if (column.type === 'category') {
      if (!isAdmin()) return '';
      return `<label>${label}<select id="field-category"><option value="prio" ${project.category === 'prio' ? 'selected' : ''}>Priorizado / Activo</option>${Object.entries(CATEGORY_STATUS).map(([key, categoryLabel]) => `<option value="${key}" ${project.category === key ? 'selected' : ''}>${categoryLabel}</option>`).join('')}</select></label>`;
    }
    if (column.type === 'select') {
      const options = Array.isArray(column.options) ? column.options : (config[column.options] || DEFAULTS[column.options] || []);
      return `<label class="${wide}">${label}<select id="field-${column.key}"><option value=""></option>${options.map(option => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
    }
    const type = column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text';
    const limits = column.type === 'number' ? 'min="0" max="100" step="1"' : '';
    return `<label class="${wide}">${label}<input id="field-${column.key}" type="${type}" ${limits} value="${escapeHtml(value)}" ${column.required ? 'required' : ''}></label>`;
  }).join('');
  $('#dlg').innerHTML = `<form id="project-form" data-project-id="${escapeHtml(id)}">
    <h2 id="dialog-title">${id ? 'Editar proyecto' : 'Nuevo proyecto'}</h2><div class="form-grid">${fields}</div>
    <div class="bar" style="justify-content:flex-end;margin-top:14px"><button type="button" class="secondary" data-action="close-dialog">Cancelar</button><button type="submit">Guardar</button></div>
    <p id="form-error" class="error" role="alert"></p></form>`;
  $('#dlg').showModal();
  $('[data-action="close-dialog"]', $('#dlg')).addEventListener('click', () => $('#dlg').close());
}

async function saveProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.projectId;
  const values = {};
  COLUMNS.forEach(column => {
    if (['n', 'mes', 'obs', 'st'].includes(column.key) || (column.key === 'prod' && currentProfile.profile === 'edicion')) return;
    const input = $(`#field-${column.key}`, form);
    if (input) values[column.key] = input.value.trim();
  });
  if (currentProfile.profile === 'edicion') values.prod = currentProfile.name;
  const comments = $('#field-obs', form)?.value.trim();
  if (comments) values.obs = [...(projects.find(project => project.id === id)?.obs || []), { d: $('#comment-date', form).value || today(), t: comments }];
  if (isAdmin()) values.category = $('#field-category', form).value;
  try {
    if (id) await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(values) });
    else await api('/api/projects', { method: 'POST', body: JSON.stringify(values) });
    $('#dlg').close();
    await refreshData();
    clearNotice();
  } catch (error) {
    $('#form-error').textContent = error.message;
  }
}

async function deleteProject(id) {
  if (!isAdmin() || !confirm('¿Eliminar este proyecto? Esta acción no se puede deshacer.')) return;
  try {
    await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshData();
    clearNotice();
  } catch (error) { notify(error.message, true); }
}

function queryView() {
  return `<h2>Consulta</h2>${filterControls(true)}${table(filteredProjects())}`;
}

function statsView() {
  return `<h2>Consulta y cifras</h2>${filterControls(false)}<button type="button" class="secondary" data-action="refresh">Actualizar cifras</button>
    <section id="stats-results"><p class="loading">Calculando estadísticas reales desde MySQL…</p></section>`;
}

async function loadStats() {
  if (page !== 'stats') return;
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.value) { query.set('field', filters.field); query.set('value', filters.value); }
  const result = await api(`/api/stats?${query}`);
  const target = $('#stats-results');
  if (!target) return;
  const totals = result.data.categories;
  const categories = Object.keys(MODULES).map(key => ({ label: MODULES[key], count: totals[key] || 0 }));
  const max = Math.max(1, ...categories.map(item => item.count));
  const stages = Object.entries(result.data.stages).map(([label, count]) => ({ label: `${STAGE_ICON[label] || ''} ${label}`, count }));
  target.innerHTML = `<div class="cards"><div class="card"><strong>${result.data.total}</strong>Proyectos en filtro</div>
    ${categories.map(item => `<div class="card"><strong>${item.count}</strong>${item.label}</div>`).join('')}</div>
    <h3>Proyectos por categoría</h3><div class="chart">${categories.map(item => chartRow(item.label, item.count, max)).join('')}</div>
    <h3>Proyectos priorizados por etapa</h3><div class="chart">${stages.map(item => chartRow(item.label, item.count, Math.max(1, ...stages.map(stage => stage.count)))).join('')}</div>
    <p class="muted">Las cifras se consultan desde MySQL; use Actualizar o registre cambios para volver a consultarlas.</p>`;
}

function chartRow(label, count, max) {
  const width = count ? Math.max(1, count / max * 100) : 0;
  return `<div class="chart-row"><span>${escapeHtml(label)}</span><div class="chart-track"><div class="chart-bar" style="width:${width}%"></div></div><b>${count}</b></div>`;
}

function timelineView() {
  const years = [timelineYear - 1, timelineYear, timelineYear + 1];
  return `<h2>Línea en el tiempo</h2><div class="bar"><label>Año <select id="timeline-year">${years.map(year => `<option value="${year}" ${year === timelineYear ? 'selected' : ''}>${year}</option>`).join('')}</select></label></div>
    <div id="timeline-results"><p class="loading">Consultando fechas e historial registrado…</p></div>`;
}

async function loadTimeline() {
  if (page !== 'timeline') return;
  const result = await api(`/api/timeline?year=${timelineYear}`);
  const target = $('#timeline-results');
  if (!target) return;
  const items = result.data.events;
  const estimateCount = result.data.estimatedByMonth.reduce((sum, month) => sum + month.count, 0);
  const events = items.map(item => `<article class="timeline-item"><time>${escapeHtml(item.at ? new Date(item.at).toLocaleString('es-CO') : 'Fecha no disponible')}</time>
    <b>${escapeHtml(item.typeLabel)}</b> — ${escapeHtml(item.projectName || 'Proyecto sin nombre')} ${item.category ? `(${escapeHtml(MODULES[item.category] || item.category)})` : ''}</article>`).join('');
  target.innerHTML = `<h3>Fechas estimadas de salida almacenadas</h3><div class="chart">${result.data.estimatedByMonth.map(item => chartRow(item.month, item.count, Math.max(1, ...result.data.estimatedByMonth.map(month => month.count)))).join('')}</div>
    <p class="muted">${estimateCount ? `${estimateCount} proyectos tienen fecha estimada de salida en ${timelineYear}.` : `No hay fechas estimadas de salida para ${timelineYear}.`}</p>
    <h3>Historial de cambios registrados</h3>${items.length ? `<div class="timeline">${events}</div>` : `<p class="empty">No existe historial suficiente para mostrar cambios anteriores. El sistema registrará creaciones, modificaciones, cambios de categoría y eliminaciones a partir de esta versión; no se inventan eventos retroactivos.</p>`}`;
}

function adminView() {
  if (!isAdmin()) return '<h2>Administrador</h2><p>Acceso restringido al perfil administrador.</p>';
  const userRows = config.users.map((user, index) => `<tr><td><input data-user="${index}" data-user-field="name" value="${escapeHtml(user.name)}" required></td>
    <td><input data-user="${index}" data-user-field="email" type="email" value="${escapeHtml(user.email)}" required></td>
    <td><select data-user="${index}" data-user-field="profile">${[['edicion', 'Editar'], ['consulta', 'Consultar'], ['administrador', 'Administrador (requiere ADMIN_EMAILS)']].map(([value, label]) => `<option value="${value}" ${user.profile === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
    <td><input data-user="${index}" data-user-field="password" type="password" autocomplete="new-password" minlength="12" value="${escapeHtml(user.password || '')}" placeholder="${user.active === false ? 'Cuenta desactivada' : 'Vacío conserva la contraseña'}"></td>
    <td><button type="button" class="secondary" data-remove-user="${index}">Eliminar</button></td></tr>`).join('');
  return `<h2>Administrador</h2><form id="admin-config-form">
    <h3>Usuarios y perfiles</h3><p class="muted">Los administradores se autorizan exclusivamente mediante ADMIN_EMAILS en el servidor.</p>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Correo electrónico</th><th>Perfil</th><th>Contraseña nueva (mínimo 12 caracteres)</th><th></th></tr></thead><tbody>${userRows || '<tr><td class="empty" colspan="5">Sin usuarios configurados.</td></tr>'}</tbody></table></div>
    <div class="bar"><button type="button" class="secondary" data-action="add-user">+ Usuario</button><button type="submit">Guardar usuarios y listas</button></div>
    <h3>Listas desplegables</h3><div class="form-grid">${[['dir', 'Responsable Dirección'], ['prod', 'Responsable producto'], ['fre', 'Frente']].map(([key, label]) =>
      `<label>${label} (uno por línea)<textarea name="${key}">${escapeHtml((config[key] || []).join('\n'))}</textarea></label>`
    ).join('')}</div></form>
    <h3>Exportar / importar Excel</h3><form id="import-form" class="bar"><label>Módulo <select id="module-select">${Object.entries(MODULES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
    <button type="button" id="export-button">Exportar a Excel</button><input id="xlsx-file" type="file" accept=".xlsx" required><button type="submit" class="secondary">Importar (reemplaza el módulo)</button></form>`;
}

async function saveAdminConfig(event) {
  event.preventDefault();
  const users = [...event.currentTarget.querySelectorAll('[data-user-field="name"]')].map((input, index) => ({
    name: input.value.trim(),
    email: $(`[data-user="${index}"][data-user-field="email"]`, event.currentTarget).value.trim(),
    profile: $(`[data-user="${index}"][data-user-field="profile"]`, event.currentTarget).value,
    password: $(`[data-user="${index}"][data-user-field="password"]`, event.currentTarget).value
  }));
  const body = { users };
  ['dir', 'prod', 'fre'].forEach(key => {
    body[key] = event.currentTarget.elements[key].value.split('\n').map(value => value.trim()).filter(Boolean);
  });
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify(body) });
    await refreshData();
    notify('Configuración guardada.');
  } catch (error) { notify(error.message, true); }
}

function updateAdminUsers() {
  ['dir', 'prod', 'fre'].forEach(key => {
    const input = $(`[name="${key}"]`);
    if (input) config[key] = input.value.split('\n').map(value => value.trim()).filter(Boolean);
  });
  const rows = [...document.querySelectorAll('[data-user-field="name"]')].map((input, index) => ({
    name: input.value,
    email: $(`[data-user="${index}"][data-user-field="email"]`).value,
    profile: $(`[data-user="${index}"][data-user-field="profile"]`).value,
    password: $(`[data-user="${index}"][data-user-field="password"]`).value
  }));
  config.users = rows;
}

function bindReordering(body) {
  let dragged;
  body.addEventListener('dragstart', event => {
    const row = event.target.closest('tr[data-project-id]');
    if (!row) return;
    dragged = row;
    row.classList.add('dragging');
  });
  body.addEventListener('dragend', () => dragged?.classList.remove('dragging'));
  body.addEventListener('dragover', event => event.preventDefault());
  body.addEventListener('drop', async event => {
    event.preventDefault();
    const target = event.target.closest('tr[data-project-id]');
    if (!dragged || !target || dragged === target) return;
    body.insertBefore(dragged, dragged.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING ? target : target.nextSibling);
    const ids = [...body.querySelectorAll('tr[data-project-id]')].map(row => row.dataset.projectId);
    try {
      await api('/api/projects/order', { method: 'PATCH', body: JSON.stringify({ ids }) });
      await refreshData();
    } catch (error) { notify(error.message, true); }
  });
}

function exportExcel() {
  if (!window.XLSX) { notify('No se cargó la librería de Excel.', true); return; }
  const module = $('#module-select').value;
  const rows = projects.filter(project => project.category === module).map((project, index) =>
    Object.fromEntries(COLUMNS.map(column => [column.label + (column.key === 'st' ? ' ' : ''), column.key === 'n' ? index + 1 :
      column.key === 'mes' ? monthOf(project.fs) : column.key === 'obs' ?
        (project.obs || []).map(item => `${item.d}: ${item.t}`).join('\n') :
        column.key === 'st' ? CATEGORY_STATUS[project.category] || 'Activo' : project[column.key] ?? '']))
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Datos');
  XLSX.writeFile(workbook, `${MODULES[module].replaceAll(' ', '_')}.xlsx`);
}

async function importExcel(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const file = $('#xlsx-file').files[0];
  if (!file || !window.XLSX) { notify('Seleccione un archivo .xlsx válido.', true); return; }
  const module = $('#module-select').value;
  if (!confirm(`Se reemplazarán los registros del módulo ${MODULES[module]}. ¿Continuar?`)) return;
  try {
    const workbook = XLSX.read(await file.arrayBuffer());
    const source = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
    const rows = source.map(row => {
      const project = {};
      COLUMNS.forEach(column => {
        if (['n', 'mes', 'st'].includes(column.key)) return;
        const legacyLabel = column.key === 'est' ? 'Estado' : column.label + (column.key === 'st' ? ' ' : '');
        const value = row[column.label] ?? row[legacyLabel] ?? '';
        if (column.key === 'obs') {
          project.obs = String(value).split('\n').filter(Boolean).map(line => {
            const match = line.match(/^(\d{4}-\d{2}-\d{2}): (.*)$/);
            return match ? { d: match[1], t: match[2] } : { d: today(), t: line };
          });
        } else project[column.key] = value;
      });
      if (module !== 'prio') project.st = CATEGORY_STATUS[module];
      return project;
    });
    await api(`/api/projects/import/${module}`, { method: 'PUT', body: JSON.stringify({ rows }) });
    await refreshData();
    notify('Importación completada.');
  } catch (error) { notify(error.message, true); }
}

initialize();
