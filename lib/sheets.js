const { google } = require('googleapis');

const DEFAULT_SPREADSHEET_ID = '1LREjud109bwtC3nOSM2lUpb6eWXoSqHrFL5YyHr4fec';
const TUTORES_SHEET = process.env.TUTORES_SHEET || 'Graduados';
const TUTORES_RANGE = `${TUTORES_SHEET}!A2:Q`;
const SELECCIONES_SHEET = process.env.SELECCIONES_SHEET || 'Selecciones';
const SELECCIONES_APPEND_RANGE = `${SELECCIONES_SHEET}!A1`;
const SELECCIONES_RANGE = `${SELECCIONES_SHEET}!A1:J`;
const CARRERAS_SHEET = process.env.CARRERAS_SHEET || 'Carreras';
const CARRERAS_RANGE = `${CARRERAS_SHEET}!A2:B`;

const HEADERS = [
  'Nombre', 'Apellido', 'DNI', 'Sexo', 'Edad', 'Graduación', 'Carrera', 'Celular', 'Mail',
  'Lugar', 'Situación laboral', 'Empresa', 'Cargo', 'Linkedin', 'Cantidad de asesorados', 'Foto', 'Cupo',
];

function getCredentials() {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) {
    throw new Error('GOOGLE_CREDENTIALS environment variable is not set');
  }
  return JSON.parse(credentialsJson);
}

function getSpreadsheetId() {
  return process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function rowToObject(row) {
  const obj = {};
  HEADERS.forEach((key, i) => {
    obj[key] = row[i] || '';
  });
  return obj;
}

async function fetchTutorRowsFromSheet() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: TUTORES_RANGE,
  });
  return res.data.values || [];
}

/** Lee hoja Carreras: columna A = filtro mentores, columna B = formulario alumno. */
async function fetchCarrerasFromSheet() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: CARRERAS_RANGE,
  });
  const rows = res.data.values || [];
  const mentores = [];
  const alumnos = [];
  const seenMentor = new Set();
  const seenAlumno = new Set();

  for (const row of rows) {
    const colA = (row[0] || '').trim();
    const colB = (row[1] || '').trim();
    const keyA = colA.toLowerCase();
    const keyB = colB.toLowerCase();

    if (colA && !seenMentor.has(keyA)) {
      seenMentor.add(keyA);
      mentores.push(colA);
    }
    if (colB && !seenAlumno.has(keyB)) {
      seenAlumno.add(keyB);
      alumnos.push(colB);
    }
  }

  return { mentores, alumnos };
}

/**
 * Agrega una fila en la hoja Selecciones (mismo formato que usaba la app antes).
 * Columnas: fecha, nombre, apellido, anioCarrera, carrera, correo, celular, linkedin, tutorNombre, tutorApellido
 */
async function appendSeleccionToSheet({ fecha, alumno, tutorNombre, tutorApellido }) {
  const sheets = await getSheetsClient();
  const fila = [
    fecha,
    alumno.nombre,
    alumno.apellido,
    alumno.anioCarrera,
    alumno.carrera,
    alumno.correo,
    alumno.celular,
    alumno.linkedin || '',
    tutorNombre,
    tutorApellido,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: SELECCIONES_APPEND_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: [fila] },
  });
}

function looksLikeSeleccionHeader(correo, celular) {
  const correoKey = correo.toLowerCase();
  const celularKey = celular.toLowerCase();
  return (
    /^(correo|mail|e-?mail)$/i.test(correoKey) ||
    /^(celular|tel[eé]fono|telefono|tel)$/i.test(celularKey)
  );
}

/**
 * Lee la hoja Selecciones.
 * Columnas: fecha, nombre, apellido, anioCarrera, carrera, correo, celular, linkedin, tutorNombre, tutorApellido
 */
async function fetchSeleccionRowsFromSheet() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: SELECCIONES_RANGE,
  });
  const rows = res.data.values || [];
  const selecciones = [];

  for (const row of rows) {
    const correo = String(row[5] || '').trim();
    const celular = String(row[6] || '').trim();
    if (!correo && !celular) continue;
    if (looksLikeSeleccionHeader(correo, celular)) continue;
    selecciones.push({
      correo,
      celular,
      nombre: String(row[1] || '').trim(),
      apellido: String(row[2] || '').trim(),
    });
  }

  return selecciones;
}

module.exports = {
  HEADERS,
  TUTORES_SHEET,
  TUTORES_RANGE,
  SELECCIONES_SHEET,
  CARRERAS_SHEET,
  fetchTutorRowsFromSheet,
  fetchCarrerasFromSheet,
  fetchSeleccionRowsFromSheet,
  appendSeleccionToSheet,
  rowToObject,
};
