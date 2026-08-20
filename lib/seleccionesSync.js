const { getPool } = require('../db/pool');
const { fetchSeleccionRowsFromSheet } = require('./sheets');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Borra de la BD las solicitudes que ya no están en la hoja Selecciones.
 * No toca cantidad_asesorados: el cupo se libera aparte con Liberar.
 */
async function syncSeleccionesFromSheet() {
  const sheetRows = await fetchSeleccionRowsFromSheet();
  const sheetEmails = new Set();
  const sheetPhones = new Set();

  for (const row of sheetRows) {
    const email = normalizeEmail(row.correo);
    const phone = normalizePhone(row.celular);
    if (email) sheetEmails.add(email);
    if (phone) sheetPhones.add(phone);
  }

  const pool = getPool();
  const existing = await pool.query(
    'SELECT id, alumno_correo, alumno_celular FROM selecciones'
  );

  const idsToDelete = [];
  for (const row of existing.rows) {
    const email = normalizeEmail(row.alumno_correo);
    const phone = normalizePhone(row.alumno_celular);
    const inSheet = (email && sheetEmails.has(email)) || (phone && sheetPhones.has(phone));
    if (!inSheet) idsToDelete.push(row.id);
  }

  if (idsToDelete.length === 0) {
    return { sheetRows: sheetRows.length, deleted: 0 };
  }

  const placeholders = idsToDelete.map((_, i) => `$${i + 1}`).join(', ');
  const deleted = await pool.query(
    `DELETE FROM selecciones WHERE id IN (${placeholders}) RETURNING id`,
    idsToDelete
  );

  return {
    sheetRows: sheetRows.length,
    deleted: deleted.rowCount || deleted.rows.length || 0,
  };
}

module.exports = { syncSeleccionesFromSheet };
