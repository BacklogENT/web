'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./db');

const projectFieldNames = {
  id: 'Identificador del proyecto',
  n: 'Nivel de priorización',
  pri: 'Prioridad',
  ri: 'Número de requerimiento inicial',
  rp: 'Número de requerimiento del proyecto',
  nom: 'Nombre del proyecto',
  fun: 'Funcionalidad',
  est: 'Estado reportado',
  fre: 'Frente',
  par: 'Participante',
  fs: 'Fecha estimada de salida',
  fj: 'Fecha de cierre en Jira',
  ej: 'Estado en Jira',
  dir: 'Responsable de dirección',
  prod: 'Responsable de producto',
  area: 'Líder del área técnica',
  av: 'Porcentaje de avance',
  obs: 'Observaciones',
  category: 'Categoría administrativa',
  created_at: 'Fecha de creación del registro',
  updated_at: 'Fecha de última actualización'
};

async function showProjects() {
  const [projects] = await pool.query(
    'SELECT * FROM projects ORDER BY category, n, created_at'
  );

  if (!projects.length) {
    console.log('No hay proyectos guardados en la base de datos.');
    return;
  }

  const readableProjects = projects.map(project =>
    Object.fromEntries(
      Object.entries(project).map(([field, value]) => [
        projectFieldNames[field] ?? field,
        value
      ])
    )
  );

  console.log(JSON.stringify(readableProjects, null, 2));
}

showProjects()
  .catch(error => {
    console.error('No se pudieron consultar los proyectos:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
