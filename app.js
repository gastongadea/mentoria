require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { syncTutoresFromSheet, importNewTutoresFromSheet } = require('./lib/tutoresSync');
const { getTutoresDisponibles, seleccionarTutor } = require('./lib/tutoresDb');
const { liberarCupo, liberarTodosCupos, getTutoresConAsignados } = require('./lib/tutoresAdmin');
const { loadAdminPreview } = require('./lib/adminPreview');
const { getCarreras } = require('./lib/carrerasDb');
const { syncCarrerasFromSheet } = require('./lib/carrerasSync');
const { requireAdminPassword } = require('./lib/adminAuth');
const { appendSeleccionToSheet } = require('./lib/sheets');
const { isCorreoInstitucional } = require('./lib/correoInstitucional');

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'graduadosfi@ing.austral.edu.ar',
    pass: process.env.GMAIL_PASS,
  },
});

function requireSyncToken(req, res) {
  const expected = process.env.ADMIN_SYNC_TOKEN;
  if (!expected) {
    res.status(503).json({
      error: 'Sync no configurado',
      details: 'Definí ADMIN_SYNC_TOKEN en las variables de entorno',
    });
    return false;
  }
  const token = req.headers['x-sync-token'] || req.query.token;
  if (token !== expected) {
    res.status(401).json({ error: 'No autorizado' });
    return false;
  }
  return true;
}

async function enviarCorreoSeleccion(tutor, alumno) {
  if (!process.env.GMAIL_PASS) {
    console.warn('GMAIL_PASS no configurado; se omite el envío de correo.');
    return;
  }

  let linkedinAlumno = '';
  if (alumno.linkedin && alumno.linkedin.trim() !== '') {
    linkedinAlumno = `- LinkedIn: ${alumno.linkedin}\n`;
  }

  const esAlumna = alumno.sexo === 'Mujer';
  const esGraduada = tutor.Sexo === 'Mujer';

  const textoAlumno = esAlumna ? 'ALUMNA' : 'ALUMNO';
  const textoGraduado = esGraduada ? 'GRADUADA' : 'GRADUADO';

  const mentorEmail = (tutor.Mail || '').split('|')[0].trim();

  const mailOptions = {
    from: 'Graduados U. Austral <graduadosfi@ing.austral.edu.ar>',
    to: `${mentorEmail}, ${alumno.correo}`,
    cc: 'desarrolloprofesional@austral.edu.ar',
    subject: '¡Conexión realizada! Mentoría FI Austral',
    text: `¡Hola! Se ha realizado una conexión alumno - graduado del Programa de Mentorías de alumnos.\n\n${textoAlumno}: ${alumno.nombre} ${alumno.apellido}\n- Carrera: ${alumno.carrera}\n- Año: ${alumno.anioCarrera}º\n- Celular: ${alumno.celular}\n${linkedinAlumno}\n\n${textoGraduado}: ${tutor.Nombre} ${tutor.Apellido}\n- Título: ${tutor.Carrera}\n- Contacto: ${tutor.Mail}\n\nLos animamos a ponerse en contacto para coordinar su primer encuentro.\n\nSaludos cordiales!\n\nDepartamento de Graduados de la Facultad de Ingeniería\nUniversidad Austral`,
  };
  await transporter.sendMail(mailOptions);
}

const api = express.Router();

api.get('/', (req, res) => {
  res.json({
    ok: true,
    endpoints: [
      'GET /api/tutores',
      'GET /api/carreras',
      'POST /api/seleccionar-tutor',
      'POST /api/admin/sync-tutores',
      'GET /api/admin/new-tutores',
      'POST /api/admin/import-new-tutores',
    ],
  });
});

api.get('/tutores', async (req, res) => {
  try {
    const tutores = await getTutoresDisponibles();
    res.json(tutores);
  } catch (err) {
    console.error('Error en /tutores:', err);
    res.status(500).json({ error: 'Error al obtener tutores', details: err.message });
  }
});

api.get('/carreras', async (req, res) => {
  try {
    const carreras = await getCarreras();
    res.json(carreras);
  } catch (err) {
    console.error('Error en /carreras:', err);
    res.status(500).json({ error: 'Error al obtener carreras', details: err.message });
  }
});

api.post('/admin/sync-tutores', async (req, res) => {
  if (!requireSyncToken(req, res)) return;

  try {
    const overwriteAsesorados = req.body?.overwriteAsesorados === true;
    const deactivateMissing = req.body?.deactivateMissing !== false;
    const stats = await syncTutoresFromSheet({ overwriteAsesorados, deactivateMissing });
    const carreras = await syncCarrerasFromSheet();
    res.json({ ok: true, ...stats, carreras });
  } catch (err) {
    console.error('Error en /admin/sync-tutores:', err);
    res.status(500).json({ error: 'Error al sincronizar tutores', details: err.message });
  }
});

api.get('/admin-new-tutores', async (req, res) => {
  if (!requireAdminPassword(req, res)) return;

  try {
    const data = await loadAdminPreview();
    res.json(data);
  } catch (err) {
    console.error('Error en /admin-new-tutores:', err);
    res.status(500).json({ error: 'Error al leer la planilla', details: err.message });
  }
});

api.post('/admin-liberar-cupo', async (req, res) => {
  if (!requireAdminPassword(req, res)) return;

  const tutorId = req.body?.id;
  if (!tutorId) {
    return res.status(400).json({ error: 'Falta el id del tutor' });
  }

  try {
    const result = await liberarCupo(tutorId);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    const tutoresConAsignados = await getTutoresConAsignados();
    res.json({ ok: true, tutor: result.tutor, tutoresConAsignados });
  } catch (err) {
    console.error('Error en /admin-liberar-cupo:', err);
    res.status(500).json({ error: 'Error al liberar cupo', details: err.message });
  }
});

api.post('/admin-liberar-todos', async (req, res) => {
  if (!requireAdminPassword(req, res)) return;

  try {
    const result = await liberarTodosCupos();
    const tutoresConAsignados = await getTutoresConAsignados();
    res.json({ ok: true, resetCount: result.resetCount, tutoresConAsignados });
  } catch (err) {
    console.error('Error en /admin-liberar-todos:', err);
    res.status(500).json({ error: 'Error al liberar cupos', details: err.message });
  }
});

api.post('/admin-import-new-tutores', async (req, res) => {
  if (!requireAdminPassword(req, res)) return;

  try {
    const stats = await importNewTutoresFromSheet();
    const carreras = await syncCarrerasFromSheet();
    res.json({ ok: true, ...stats, carreras });
  } catch (err) {
    console.error('Error en /admin-import-new-tutores:', err);
    res.status(500).json({ error: 'Error al importar tutores', details: err.message });
  }
});

api.post('/seleccionar-tutor', async (req, res) => {
  const { tutor, alumno } = req.body;
  if (!tutor || !alumno) {
    return res.status(400).json({ error: 'Faltan datos de tutor o alumno' });
  }
  if (!isCorreoInstitucional(alumno.correo)) {
    return res.status(400).json({
      error: 'El correo debe ser institucional (@austral.edu.ar o subdominio, ej. @ing.austral.edu.ar).',
    });
  }

  try {
    const result = await seleccionarTutor(tutor, alumno);

    if (!result.ok) {
      const status = result.status || 400;
      return res.status(status).json({
        error: result.error,
        ...(result.solicitudPrevia ? { solicitudPrevia: result.solicitudPrevia } : {}),
      });
    }

    try {
      await appendSeleccionToSheet({
        fecha: result.fecha,
        alumno,
        tutorNombre: tutor.Nombre,
        tutorApellido: tutor.Apellido,
      });
    } catch (err) {
      console.error('Error al registrar selección en Google Sheets:', err);
    }

    try {
      await enviarCorreoSeleccion(result.tutor, alumno);
    } catch (err) {
      console.error('Error enviando correo:', err);
    }

    res.json({ ok: true, mensaje: 'Selección registrada y cupo descontado' });
  } catch (err) {
    console.error('Error en /seleccionar-tutor:', err);
    res.status(500).json({ error: 'Error al seleccionar tutor', details: err.message });
  }
});

let carrerasBootstrapped = false;

async function bootstrapCarreras() {
  if (carrerasBootstrapped) return;
  carrerasBootstrapped = true;
  try {
    const carreras = await getCarreras();
    if (carreras.mentores.length === 0 && carreras.alumnos.length === 0) {
      console.log('Tabla carreras vacía; sincronizando desde Google Sheets...');
      await syncCarrerasFromSheet();
    }
  } catch (err) {
    carrerasBootstrapped = false;
    console.warn('No se pudieron inicializar carreras:', err.message);
  }
}

app.use('/api', api);

module.exports = app;
module.exports.bootstrapCarreras = bootstrapCarreras;
