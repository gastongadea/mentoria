const { seleccionarTutor } = require('../lib/tutoresDb');
const { appendSeleccionToSheet } = require('../lib/sheets');
const { isCorreoInstitucional } = require('../lib/correoInstitucional');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'graduadosfi@ing.austral.edu.ar',
    pass: process.env.GMAIL_PASS,
  },
});

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

  await transporter.sendMail({
    from: 'Graduados U. Austral <graduadosfi@ing.austral.edu.ar>',
    to: `${mentorEmail}, ${alumno.correo}`,
    cc: 'desarrolloprofesional@austral.edu.ar',
    subject: '¡Conexión realizada! Mentoría FI Austral',
    text: `¡Hola! Se ha realizado una conexión alumno - graduado del Programa de Mentorías de alumnos.\n\n${textoAlumno}: ${alumno.nombre} ${alumno.apellido}\n- Carrera: ${alumno.carrera}\n- Año: ${alumno.anioCarrera}º\n- Celular: ${alumno.celular}\n${linkedinAlumno}\n\n${textoGraduado}: ${tutor.Nombre} ${tutor.Apellido}\n- Título: ${tutor.Carrera}\n- Contacto: ${tutor.Mail}\n\nLos animamos a ponerse en contacto para coordinar su primer encuentro.\n\nSaludos cordiales!\n\nDepartamento de Graduados de la Facultad de Ingeniería\nUniversidad Austral`,
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tutor, alumno } = req.body || {};
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
    console.error('Error en /api/seleccionar-tutor:', err);
    res.status(500).json({ error: 'Error al seleccionar tutor', details: err.message });
  }
};
