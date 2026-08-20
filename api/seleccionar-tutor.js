require('dotenv').config();
const { seleccionarTutor } = require('../lib/tutoresDb');
const { appendSeleccionToSheet } = require('../lib/sheets');
const { isCorreoInstitucional } = require('../lib/correoInstitucional');
const { enviarCorreoSeleccion } = require('../lib/mail');

function readJsonBody(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  if (typeof body === 'string' && body.trim()) {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tutor, alumno } = readJsonBody(req);
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

    const [sheetResult, mailResult] = await Promise.allSettled([
      appendSeleccionToSheet({
        fecha: result.fecha,
        alumno,
        tutorNombre: tutor.Nombre,
        tutorApellido: tutor.Apellido,
      }),
      enviarCorreoSeleccion(result.tutor, alumno),
    ]);
    if (sheetResult.status === 'rejected') {
      console.error('Error al registrar selección en Google Sheets:', sheetResult.reason);
    }
    if (mailResult.status === 'rejected') {
      console.error('Error enviando correo:', mailResult.reason);
    }

    res.json({ ok: true, mensaje: 'Selección registrada y cupo descontado' });
  } catch (err) {
    console.error('Error en /api/seleccionar-tutor:', err);
    res.status(500).json({ error: 'Error al seleccionar tutor', details: err.message });
  }
};
