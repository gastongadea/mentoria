const { getPool } = require('../db/pool');

function mapTutorRow(row) {
  const cupoDisponible = Math.max(0, row.cupo_maximo - row.cantidad_asesorados);
  return {
    Nombre: row.nombre,
    Apellido: row.apellido,
    Sexo: row.sexo || '',
    Graduación: row.graduacion != null ? String(row.graduacion) : '',
    Carrera: row.carrera || '',
    Celular: row.celular || '',
    Mail: row.mail || '',
    Lugar: row.lugar || '',
    Empresa: row.empresa || '',
    Cargo: row.cargo || '',
    Linkedin: row.linkedin || '',
    Foto: row.foto_url || '',
    'Cantidad de asesorados': String(row.cantidad_asesorados),
    Cupo: String(row.cupo_maximo),
    'Cupo disponible': cupoDisponible,
  };
}

function mapTutorForEmail(row) {
  return {
    Nombre: row.nombre,
    Apellido: row.apellido,
    Mail: row.mail || '',
    Carrera: row.carrera || '',
    Sexo: row.sexo || '',
  };
}

function formatFechaSeleccion(date) {
  return new Date(date).toLocaleString('es-AR');
}

async function getTutoresDisponibles() {
  const pool = getPool();
  const res = await pool.query(
    `SELECT
      nombre, apellido, sexo, graduacion, carrera, celular, mail, lugar,
      empresa, cargo, linkedin, foto_url, cupo_maximo, cantidad_asesorados
    FROM tutores
    WHERE activo = true
    ORDER BY lower(nombre), lower(apellido)`
  );
  return res.rows.map(mapTutorRow);
}

async function buscarSolicitudPrevia(alumno) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT s.created_at, t.nombre, t.apellido
     FROM selecciones s
     JOIN tutores t ON t.id = s.tutor_id
     WHERE lower(s.alumno_correo) = lower($1) OR s.alumno_celular = $2
     LIMIT 1`,
    [alumno.correo, alumno.celular]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    fecha: formatFechaSeleccion(row.created_at),
    tutor: `${row.nombre} ${row.apellido}`,
  };
}

async function seleccionarTutor(tutor, alumno) {
  const pool = getPool();
  const client = await pool.connect();

  const anioCarrera = parseInt(String(alumno.anioCarrera).trim(), 10);

  try {
    await client.query('BEGIN');

    const previa = await client.query(
      `SELECT s.created_at, t.nombre, t.apellido
       FROM selecciones s
       JOIN tutores t ON t.id = s.tutor_id
       WHERE lower(s.alumno_correo) = lower($1) OR s.alumno_celular = $2
       LIMIT 1`,
      [alumno.correo, alumno.celular]
    );

    if (previa.rows.length > 0) {
      await client.query('ROLLBACK');
      const row = previa.rows[0];
      return {
        ok: false,
        error: 'Ya tienes una solicitud de tutor registrada. No puedes solicitar otro tutor.',
        solicitudPrevia: {
          fecha: formatFechaSeleccion(row.created_at),
          tutor: `${row.nombre} ${row.apellido}`,
        },
      };
    }

    const tutorRes = await client.query(
      `SELECT *
       FROM tutores
       WHERE activo = true
         AND lower(nombre) = lower($1)
         AND lower(apellido) = lower($2)
       FOR UPDATE`,
      [tutor.Nombre, tutor.Apellido]
    );

    if (tutorRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Tutor no encontrado', status: 404 };
    }

    const tutorRow = tutorRes.rows[0];
    const cupoDisponible = tutorRow.cupo_maximo - tutorRow.cantidad_asesorados;

    if (cupoDisponible <= 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'El tutor no tiene cupo disponible', status: 400 };
    }

    const insertRes = await client.query(
      `INSERT INTO selecciones (
        tutor_id, alumno_nombre, alumno_apellido, alumno_anio_carrera,
        alumno_carrera, alumno_correo, alumno_celular, alumno_linkedin, alumno_sexo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING created_at`,
      [
        tutorRow.id,
        alumno.nombre,
        alumno.apellido,
        Number.isNaN(anioCarrera) ? null : anioCarrera,
        alumno.carrera,
        alumno.correo,
        alumno.celular,
        alumno.linkedin || null,
        alumno.sexo || null,
      ]
    );

    await client.query(
      `UPDATE tutores
       SET cantidad_asesorados = cantidad_asesorados + 1, updated_at = now()
       WHERE id = $1`,
      [tutorRow.id]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      tutor: mapTutorForEmail(tutorRow),
      fecha: formatFechaSeleccion(insertRes.rows[0].created_at),
    };
  } catch (err) {
    await client.query('ROLLBACK');

    if (err.code === '23505') {
      const previa = await buscarSolicitudPrevia(alumno);
      return {
        ok: false,
        error: 'Ya tienes una solicitud de tutor registrada. No puedes solicitar otro tutor.',
        solicitudPrevia: previa,
      };
    }

    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getTutoresDisponibles,
  buscarSolicitudPrevia,
  seleccionarTutor,
};
