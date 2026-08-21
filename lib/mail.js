const nodemailer = require('nodemailer');

const DEFAULT_USER = 'graduadosfi@ing.austral.edu.ar';
const DEFAULT_FROM_NAME = 'Graduados U. Austral';
const DEFAULT_CC = 'desarrolloprofesional@austral.edu.ar';

function getMailConfig() {
  const user = (process.env.SMTP_USER || process.env.GMAIL_USER || DEFAULT_USER).trim();
  const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
  const fromAddress = (process.env.MAIL_FROM || user).trim();
  const provider = (process.env.MAIL_PROVIDER || 'gmail').trim().toLowerCase();
  const useGmail = provider !== 'microsoft' && !process.env.SMTP_HOST;

  // Cuentas Google (incluye @ing.austral.edu.ar) salen por smtp.gmail.com, no por Office 365.
  const host = process.env.SMTP_HOST || (useGmail ? 'smtp.gmail.com' : 'smtp.office365.com');
  const port = Number(process.env.SMTP_PORT) || (useGmail || /gmail/i.test(host) ? 465 : 587);
  const secure =
    process.env.SMTP_SECURE != null
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;

  return { user, pass, fromAddress, host, port, secure };
}

function createTransporter() {
  const { user, pass, host, port, secure } = getMailConfig();
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    pool: false,
    family: 4,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { minVersion: 'TLSv1.2' },
  });
}

function buildSeleccionText(tutor, alumno) {
  let linkedinAlumno = '';
  if (alumno.linkedin && alumno.linkedin.trim() !== '') {
    linkedinAlumno = `- LinkedIn: ${alumno.linkedin}\n`;
  }

  const esAlumna = alumno.sexo === 'Mujer';
  const esGraduada = tutor.Sexo === 'Mujer';
  const textoAlumno = esAlumna ? 'ALUMNA' : 'ALUMNO';
  const textoGraduado = esGraduada ? 'GRADUADA' : 'GRADUADO';

  return `¡Hola! Se ha realizado una conexión alumno - graduado del Programa de Mentoría Profesional\n\n${textoAlumno}: ${alumno.nombre} ${alumno.apellido}\n- Carrera: ${alumno.carrera}\n- Año: ${alumno.anioCarrera}º\n- Celular: ${alumno.celular}\n${linkedinAlumno}\n\n${textoGraduado}: ${tutor.Nombre} ${tutor.Apellido}\n- Título: ${tutor.Carrera}\n- Contacto: ${tutor.Mail}\n\nLos animamos a ponerse en contacto para coordinar su primer encuentro.\n\nSaludos cordiales!\n\nLucrecia Campos\nCoordinadora Desarrollo Profesional - Graduados\nUniversidad Austral\nlcamposgalindez@austral.edu.ar\n11 4449 5541\nwww.austral.edu.ar`;
}

async function enviarCorreoSeleccion(tutor, alumno) {
  const { user, pass, fromAddress, host, port } = getMailConfig();
  if (!pass) {
    console.warn('SMTP_PASS/GMAIL_PASS no configurado; se omite el envío de correo.');
    return { sent: false, reason: 'missing_password' };
  }

  const mentorEmail = (tutor.Mail || '').split('|')[0].trim();
  const recipients = [mentorEmail, (alumno.correo || '').trim()].filter(Boolean);
  if (recipients.length === 0) {
    console.warn('Sin destinatarios; se omite el envío de correo.');
    return { sent: false, reason: 'no_recipients' };
  }

  const transporter = createTransporter();
  try {
    const info = await transporter.sendMail({
      from: `${DEFAULT_FROM_NAME} <${fromAddress}>`,
      to: recipients.join(', '),
      cc: process.env.MAIL_CC || DEFAULT_CC,
      subject: '¡Conexión realizada! Mentoría  Profesional - Universidad Austral',
      text: buildSeleccionText(tutor, alumno),
    });
    console.log('Correo de conexión enviado', {
      messageId: info.messageId,
      accepted: info.accepted,
      host,
      port,
      user,
      to: recipients,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('Error enviando correo:', {
      message: err.message,
      code: err.code,
      response: err.response,
      host,
      port,
      user,
    });
    throw err;
  } finally {
    transporter.close();
  }
}

module.exports = { enviarCorreoSeleccion, getMailConfig };
