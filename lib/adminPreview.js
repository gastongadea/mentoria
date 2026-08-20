const { syncCarrerasFromSheet } = require('./carrerasSync');
const { previewNewTutoresFromSheet, syncExistingTutorFieldsFromSheet } = require('./tutoresSync');
const { syncSeleccionesFromSheet } = require('./seleccionesSync');
const { getTutoresConAsignados } = require('./tutoresAdmin');

async function loadAdminPreview() {
  const carreras = await syncCarrerasFromSheet();
  const fields = await syncExistingTutorFieldsFromSheet();
  const selecciones = await syncSeleccionesFromSheet();
  const preview = await previewNewTutoresFromSheet();
  const tutoresConAsignados = await getTutoresConAsignados();
  return {
    ok: true,
    ...preview,
    carreras,
    seleccionesDeleted: selecciones.deleted,
    seleccionesSheetRows: selecciones.sheetRows,
    cuposUpdated: fields.cuposUpdated,
    linkedinUpdated: fields.linkedinUpdated,
    fotosUpdated: fields.fotosUpdated,
    nombresUpdated: fields.nombresUpdated,
    carrerasUpdated: fields.carrerasUpdated,
    graduacionesUpdated: fields.graduacionesUpdated,
    empresasUpdated: fields.empresasUpdated,
    cargosUpdated: fields.cargosUpdated,
    profilesUpdated: fields.profilesUpdated,
    deactivated: fields.deactivated,
    reactivated: fields.reactivated,
    tutoresConAsignados,
  };
}

module.exports = { loadAdminPreview };
