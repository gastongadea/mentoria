const { getPool } = require('../db/pool');
const { fetchTutorRowsFromSheet, rowToObject } = require('./sheets');
const { normalizeDrivePhotoUrl } = require('./drivePhotos');
const { syncCarrerasFromSheet } = require('./carrerasSync');

function parseIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(String(value).trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function sheetRowToTutorRecord(row) {
  const obj = rowToObject(row);
  const nombre = (obj.Nombre || '').trim();
  const apellido = (obj.Apellido || '').trim();
  const dniRaw = (obj.DNI || '').trim();

  if (!nombre && !apellido) return null;

  return {
    nombre,
    apellido,
    dni: dniRaw || null,
    sexo: (obj.Sexo || '').trim() || null,
    edad: parseIntOrNull(obj.Edad),
    graduacion: parseIntOrNull(obj['Graduación']),
    carrera: (obj.Carrera || '').trim() || null,
    celular: (obj.Celular || '').trim() || null,
    mail: (obj.Mail || '').trim() || null,
    lugar: (obj.Lugar || '').trim() || null,
    situacion_laboral: (obj['Situación laboral'] || '').trim() || null,
    empresa: (obj.Empresa || '').trim() || null,
    cargo: (obj.Cargo || '').trim() || null,
    linkedin: (obj.Linkedin || '').trim() || null,
    cantidad_asesorados: parseIntOrNull(obj['Cantidad de asesorados']) ?? 0,
    foto_url: normalizeDrivePhotoUrl(obj.Foto) || null,
    cupo_maximo: parseIntOrNull(obj.Cupo) ?? 0,
  };
}

async function findExistingTutorId(db, tutor) {
  if (tutor.dni) {
    const byDni = await db.query(
      'SELECT id FROM tutores WHERE dni = $1 LIMIT 1',
      [tutor.dni]
    );
    if (byDni.rows.length > 0) return byDni.rows[0].id;
  }

  const byName = await db.query(
    `SELECT id FROM tutores
     WHERE lower(nombre) = lower($1) AND lower(apellido) = lower($2)
     LIMIT 1`,
    [tutor.nombre, tutor.apellido]
  );
  return byName.rows.length > 0 ? byName.rows[0].id : null;
}

async function deactivateTutoresMissingFromSheet(client, syncedIds) {
  if (syncedIds.length === 0) return 0;
  const deactivateRes = await client.query(
    `UPDATE tutores
     SET activo = false, updated_at = now()
     WHERE id <> ALL($1::int[]) AND activo = true`,
    [syncedIds]
  );
  return deactivateRes.rowCount;
}

/**
 * Actualiza cupo, LinkedIn, foto y estado activo desde la planilla para tutores ya existentes.
 * Da de baja (activo=false) a quienes ya no están en la hoja; reactiva si vuelven a aparecer.
 * No modifica cantidad_asesorados.
 */
async function syncExistingTutorFieldsFromSheet() {
  const rows = await fetchTutorRowsFromSheet();
  const tutors = rows.map(sheetRowToTutorRecord).filter(Boolean);
  const pool = getPool();
  const client = await pool.connect();
  const stats = {
    cuposUpdated: 0,
    linkedinUpdated: 0,
    fotosUpdated: 0,
    profilesUpdated: 0,
    deactivated: 0,
    reactivated: 0,
  };
  const syncedIds = [];

  try {
    await client.query('BEGIN');

    for (const tutor of tutors) {
      const existingId = await findExistingTutorId(client, tutor);
      if (!existingId) continue;

      syncedIds.push(existingId);

      const res = await client.query(
        `WITH before AS (
           SELECT cupo_maximo, linkedin, foto_url
           FROM tutores
           WHERE id = $4
         )
         UPDATE tutores t
         SET cupo_maximo = $1,
             linkedin = $2,
             foto_url = $3,
             updated_at = now()
         FROM before
         WHERE t.id = $4
           AND (
             before.cupo_maximo IS DISTINCT FROM $1
             OR before.linkedin IS DISTINCT FROM $2
             OR before.foto_url IS DISTINCT FROM $3
           )
         RETURNING
           (before.cupo_maximo IS DISTINCT FROM $1) AS cupo_changed,
           (before.linkedin IS DISTINCT FROM $2) AS linkedin_changed,
           (before.foto_url IS DISTINCT FROM $3) AS foto_changed`,
        [tutor.cupo_maximo, tutor.linkedin, tutor.foto_url, existingId]
      );

      if (res.rows.length > 0) {
        const change = res.rows[0];
        stats.profilesUpdated += 1;
        if (change.cupo_changed) stats.cuposUpdated += 1;
        if (change.linkedin_changed) stats.linkedinUpdated += 1;
        if (change.foto_changed) stats.fotosUpdated += 1;
      }

      const reactivateRes = await client.query(
        `UPDATE tutores
         SET activo = true, updated_at = now()
         WHERE id = $1 AND activo = false
         RETURNING id`,
        [existingId]
      );
      if (reactivateRes.rows.length > 0) stats.reactivated += 1;
    }

    stats.deactivated = await deactivateTutoresMissingFromSheet(client, syncedIds);

    await client.query('COMMIT');
    return stats;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function syncCuposFromSheet() {
  return syncExistingTutorFieldsFromSheet();
}

async function upsertTutor(client, tutor, { overwriteAsesorados }) {
  const existingId = await findExistingTutorId(client, tutor);

  if (existingId) {
    if (overwriteAsesorados) {
      await client.query(
        `UPDATE tutores SET
          nombre = $1,
          apellido = $2,
          dni = COALESCE($3, dni),
          sexo = $4,
          edad = $5,
          graduacion = $6,
          carrera = $7,
          celular = $8,
          mail = $9,
          lugar = $10,
          situacion_laboral = $11,
          empresa = $12,
          cargo = $13,
          linkedin = $14,
          cantidad_asesorados = $15,
          foto_url = $16,
          cupo_maximo = $17,
          activo = true,
          updated_at = now()
        WHERE id = $18`,
        [
          tutor.nombre,
          tutor.apellido,
          tutor.dni,
          tutor.sexo,
          tutor.edad,
          tutor.graduacion,
          tutor.carrera,
          tutor.celular,
          tutor.mail,
          tutor.lugar,
          tutor.situacion_laboral,
          tutor.empresa,
          tutor.cargo,
          tutor.linkedin,
          tutor.cantidad_asesorados,
          tutor.foto_url,
          tutor.cupo_maximo,
          existingId,
        ]
      );
    } else {
      await client.query(
        `UPDATE tutores SET
          nombre = $1,
          apellido = $2,
          dni = COALESCE($3, dni),
          sexo = $4,
          edad = $5,
          graduacion = $6,
          carrera = $7,
          celular = $8,
          mail = $9,
          lugar = $10,
          situacion_laboral = $11,
          empresa = $12,
          cargo = $13,
          linkedin = $14,
          foto_url = $15,
          cupo_maximo = $16,
          activo = true,
          updated_at = now()
        WHERE id = $17`,
        [
          tutor.nombre,
          tutor.apellido,
          tutor.dni,
          tutor.sexo,
          tutor.edad,
          tutor.graduacion,
          tutor.carrera,
          tutor.celular,
          tutor.mail,
          tutor.lugar,
          tutor.situacion_laboral,
          tutor.empresa,
          tutor.cargo,
          tutor.linkedin,
          tutor.foto_url,
          tutor.cupo_maximo,
          existingId,
        ]
      );
    }
    return 'updated';
  }

  await insertTutor(client, tutor);
  return 'inserted';
}

async function insertTutor(client, tutor) {
  await client.query(
    `INSERT INTO tutores (
      nombre, apellido, dni, sexo, edad, graduacion, carrera, celular, mail,
      lugar, situacion_laboral, empresa, cargo, linkedin,
      cantidad_asesorados, foto_url, cupo_maximo, activo
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14,
      $15, $16, $17, true
    )`,
    [
      tutor.nombre,
      tutor.apellido,
      tutor.dni,
      tutor.sexo,
      tutor.edad,
      tutor.graduacion,
      tutor.carrera,
      tutor.celular,
      tutor.mail,
      tutor.lugar,
      tutor.situacion_laboral,
      tutor.empresa,
      tutor.cargo,
      tutor.linkedin,
      tutor.cantidad_asesorados,
      tutor.foto_url,
      tutor.cupo_maximo,
    ]
  );
}

async function findNewTutoresInSheet(client) {
  const rows = await fetchTutorRowsFromSheet();
  const tutors = rows.map(sheetRowToTutorRecord).filter(Boolean);
  const newTutors = [];

  for (const tutor of tutors) {
    const existingId = await findExistingTutorId(client, tutor);
    if (!existingId) {
      newTutors.push({
        nombre: tutor.nombre,
        apellido: tutor.apellido,
        dni: tutor.dni,
        carrera: tutor.carrera,
        cupo_maximo: tutor.cupo_maximo,
      });
    }
  }

  return {
    sheetRows: rows.length,
    inSheet: tutors.length,
    newCount: newTutors.length,
    newTutors,
  };
}

/** Lista filas de la hoja Graduados que aún no están en Neon. */
async function previewNewTutoresFromSheet() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await findNewTutoresInSheet(client);
  } finally {
    client.release();
  }
}

/** Inserta en Neon solo los tutores nuevos detectados en la planilla. */
async function importNewTutoresFromSheet() {
  const pool = getPool();
  const client = await pool.connect();

  const stats = {
    sheetRows: 0,
    inSheet: 0,
    inserted: 0,
    alreadyExists: 0,
    added: [],
  };

  try {
    await client.query('BEGIN');

    const rows = await fetchTutorRowsFromSheet();
    const tutors = rows.map(sheetRowToTutorRecord).filter(Boolean);
    stats.sheetRows = rows.length;
    stats.inSheet = tutors.length;

    for (const tutor of tutors) {
      const existingId = await findExistingTutorId(client, tutor);
      if (existingId) {
        stats.alreadyExists += 1;
        continue;
      }

      await insertTutor(client, tutor);
      stats.inserted += 1;
      stats.added.push({
        nombre: tutor.nombre,
        apellido: tutor.apellido,
        carrera: tutor.carrera,
      });
    }

    await client.query('COMMIT');
    return stats;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sincroniza tutores desde Google Sheets hacia Neon.
 *
 * @param {object} options
 * @param {boolean} [options.overwriteAsesorados=false] Si true, pisa cantidad_asesorados desde la planilla.
 * @param {boolean} [options.deactivateMissing=true] Marca activo=false a tutores que ya no están en la planilla.
 */
async function syncTutoresFromSheet(options = {}) {
  const overwriteAsesorados = options.overwriteAsesorados === true;
  const deactivateMissing = options.deactivateMissing !== false;

  const rows = await fetchTutorRowsFromSheet();
  const tutors = rows.map(sheetRowToTutorRecord).filter(Boolean);

  const pool = getPool();
  const client = await pool.connect();

  const stats = {
    sheetRows: rows.length,
    processed: tutors.length,
    inserted: 0,
    updated: 0,
    skipped: rows.length - tutors.length,
    deactivated: 0,
    overwriteAsesorados,
    deactivateMissing,
  };

  const syncedIds = [];

  try {
    await client.query('BEGIN');

    for (const tutor of tutors) {
      const action = await upsertTutor(client, tutor, { overwriteAsesorados });
      if (action === 'inserted') stats.inserted += 1;
      if (action === 'updated') stats.updated += 1;

      const id = await findExistingTutorId(client, tutor);
      if (id) syncedIds.push(id);
    }

    if (deactivateMissing) {
      stats.deactivated = await deactivateTutoresMissingFromSheet(client, syncedIds);
    }

    await client.query('COMMIT');
    const carreras = await syncCarrerasFromSheet();
    return { ...stats, carreras };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  syncTutoresFromSheet,
  syncCuposFromSheet,
  syncExistingTutorFieldsFromSheet,
  previewNewTutoresFromSheet,
  importNewTutoresFromSheet,
  sheetRowToTutorRecord,
};
